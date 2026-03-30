package sshsessions

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/redis/go-redis/v9"
)

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

func (s Service) resolveCredentials(ctx context.Context, userID string, payload createRequest, access connectionAccess) (resolvedCredentials, error) {
	if payload.CredentialMode == "domain" {
		return s.resolveDomainCredentials(ctx, userID)
	}
	if payload.Username != "" && payload.Password != "" {
		return resolvedCredentials{
			Username:         payload.Username,
			Password:         payload.Password,
			CredentialSource: "manual",
		}, nil
	}

	if access.Connection.ExternalVaultProviderID != nil || access.Connection.ExternalVaultPath != nil || access.Connection.CredentialSecretID != nil {
		return resolvedCredentials{}, ErrLegacySSHSessionFlow
	}

	switch access.AccessType {
	case "owner":
		key, _, err := s.getUserMasterKey(ctx, userID)
		if err != nil {
			return resolvedCredentials{}, err
		}
		if len(key) == 0 {
			return resolvedCredentials{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
		}
		defer zeroBytes(key)
		return decryptInlineCredentials(access.Connection, key)
	case "team":
		if access.Connection.TeamID == nil || *access.Connection.TeamID == "" {
			return resolvedCredentials{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
		}
		key, err := s.getTeamVaultKey(ctx, *access.Connection.TeamID, userID)
		if err != nil {
			return resolvedCredentials{}, err
		}
		if len(key) == 0 {
			return resolvedCredentials{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
		}
		defer zeroBytes(key)
		return decryptInlineCredentials(access.Connection, key)
	case "shared":
		key, _, err := s.getUserMasterKey(ctx, userID)
		if err != nil {
			return resolvedCredentials{}, err
		}
		if len(key) == 0 {
			return resolvedCredentials{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
		}
		defer zeroBytes(key)
		return decryptSharedCredentials(access.Connection, key)
	default:
		return resolvedCredentials{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
	}
}

func (s Service) resolveDomainCredentials(ctx context.Context, userID string) (resolvedCredentials, error) {
	var (
		domainUsername    *string
		encryptedPassword *string
		passwordIV        *string
		passwordTag       *string
	)
	if err := s.DB.QueryRow(ctx, `
SELECT "domainUsername", "encryptedDomainPassword", "domainPasswordIV", "domainPasswordTag"
FROM "User"
WHERE id = $1
`, userID).Scan(&domainUsername, &encryptedPassword, &passwordIV, &passwordTag); err != nil {
		return resolvedCredentials{}, fmt.Errorf("load domain credentials: %w", err)
	}
	if domainUsername == nil || *domainUsername == "" || encryptedPassword == nil || passwordIV == nil || passwordTag == nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Domain credentials are incomplete. Configure your domain profile in Settings first."}
	}
	key, _, err := s.getUserMasterKey(ctx, userID)
	if err != nil {
		return resolvedCredentials{}, err
	}
	if len(key) == 0 {
		return resolvedCredentials{}, &requestError{status: 403, message: "Vault must be unlocked to access domain credentials"}
	}
	defer zeroBytes(key)

	password, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *encryptedPassword,
		IV:         *passwordIV,
		Tag:        *passwordTag,
	})
	if err != nil {
		return resolvedCredentials{}, fmt.Errorf("decrypt domain credentials: %w", err)
	}

	return resolvedCredentials{
		Username:         *domainUsername,
		Password:         password,
		CredentialSource: "domain",
	}, nil
}

func decryptInlineCredentials(connection connectionRecord, key []byte) (resolvedCredentials, error) {
	if connection.EncryptedUsername == nil || connection.UsernameIV == nil || connection.UsernameTag == nil ||
		connection.EncryptedPassword == nil || connection.PasswordIV == nil || connection.PasswordTag == nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Connection has no credentials configured"}
	}

	username, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *connection.EncryptedUsername,
		IV:         *connection.UsernameIV,
		Tag:        *connection.UsernameTag,
	})
	if err != nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Connection has no credentials configured"}
	}
	password, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *connection.EncryptedPassword,
		IV:         *connection.PasswordIV,
		Tag:        *connection.PasswordTag,
	})
	if err != nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Connection has no credentials configured"}
	}

	return resolvedCredentials{
		Username:         username,
		Password:         password,
		CredentialSource: "saved",
	}, nil
}

func decryptSharedCredentials(connection connectionRecord, key []byte) (resolvedCredentials, error) {
	if connection.SharedEncryptedUsername == nil || connection.SharedUsernameIV == nil || connection.SharedUsernameTag == nil ||
		connection.SharedEncryptedPassword == nil || connection.SharedPasswordIV == nil || connection.SharedPasswordTag == nil {
		return resolvedCredentials{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
	}

	username, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *connection.SharedEncryptedUsername,
		IV:         *connection.SharedUsernameIV,
		Tag:        *connection.SharedUsernameTag,
	})
	if err != nil {
		return resolvedCredentials{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
	}
	password, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *connection.SharedEncryptedPassword,
		IV:         *connection.SharedPasswordIV,
		Tag:        *connection.SharedPasswordTag,
	})
	if err != nil {
		return resolvedCredentials{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
	}

	return resolvedCredentials{
		Username:         username,
		Password:         password,
		CredentialSource: "saved",
	}, nil
}

func (s Service) getUserMasterKey(ctx context.Context, userID string) ([]byte, time.Duration, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, 0, nil
	}

	userKey := "vault:user:" + userID
	recoveryKey := "vault:recovery:" + userID
	for _, key := range []string{userKey, recoveryKey} {
		payload, err := s.Redis.Get(ctx, key).Bytes()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				continue
			}
			return nil, 0, fmt.Errorf("load vault session: %w", err)
		}

		var field encryptedField
		normalized, err := rediscompat.DecodeJSONPayload(payload, &field)
		if err != nil {
			return nil, 0, fmt.Errorf("decode vault session payload: %w", err)
		}

		hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
		if err != nil {
			return nil, 0, fmt.Errorf("decrypt vault session: %w", err)
		}
		masterKey, err := hex.DecodeString(hexKey)
		if err != nil {
			return nil, 0, fmt.Errorf("decode vault master key: %w", err)
		}

		ttl := 30 * time.Minute
		if pttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && pttl > 0 {
			ttl = pttl
		}
		if key == recoveryKey {
			_ = s.Redis.Set(ctx, userKey, normalized, ttl).Err()
		} else {
			_ = s.Redis.Set(ctx, userKey, normalized, ttl).Err()
		}
		return masterKey, ttl, nil
	}

	return nil, 0, nil
}

func (s Service) getTeamVaultKey(ctx context.Context, teamID, userID string) ([]byte, error) {
	if cached, err := s.getCachedTeamKey(ctx, teamID, userID); err == nil && len(cached) > 0 {
		return cached, nil
	} else if err != nil {
		return nil, err
	}

	userKey, ttl, err := s.getUserMasterKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(userKey) == 0 {
		return nil, nil
	}
	defer zeroBytes(userKey)

	var field encryptedField
	if err := s.DB.QueryRow(ctx, `
SELECT "encryptedTeamVaultKey", "teamVaultKeyIV", "teamVaultKeyTag"
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, userID).Scan(&field.Ciphertext, &field.IV, &field.Tag); err != nil {
		return nil, fmt.Errorf("load team vault key: %w", err)
	}

	hexKey, err := decryptEncryptedField(userKey, field)
	if err != nil {
		return nil, &requestError{status: 500, message: "Unable to access team vault key"}
	}
	teamKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode team vault key: %w", err)
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	_ = s.storeTeamKey(ctx, teamID, userID, teamKey, ttl)
	return teamKey, nil
}

func (s Service) getCachedTeamKey(ctx context.Context, teamID, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, nil
	}
	key := "vault:team:" + teamID + ":" + userID
	payload, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load team vault session: %w", err)
	}
	var field encryptedField
	normalized, err := rediscompat.DecodeJSONPayload(payload, &field)
	if err != nil {
		return nil, fmt.Errorf("decode team vault payload: %w", err)
	}
	hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt team vault payload: %w", err)
	}
	teamKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode team vault key: %w", err)
	}
	if ttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && ttl > 0 {
		_ = s.Redis.Set(ctx, key, normalized, ttl).Err()
	}
	return teamKey, nil
}

func (s Service) storeTeamKey(ctx context.Context, teamID, userID string, teamKey []byte, ttl time.Duration) error {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil
	}
	field, err := encryptHexPayload(s.ServerEncryptionKey, hex.EncodeToString(teamKey))
	if err != nil {
		return err
	}
	raw, err := json.Marshal(field)
	if err != nil {
		return err
	}
	return s.Redis.Set(ctx, "vault:team:"+teamID+":"+userID, raw, ttl).Err()
}

func encryptHexPayload(key []byte, value string) (encryptedField, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return encryptedField{}, fmt.Errorf("generate nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(value), nil)
	tagSize := gcm.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:len(sealed)-tagSize]),
		IV:         hex.EncodeToString(nonce),
		Tag:        hex.EncodeToString(sealed[len(sealed)-tagSize:]),
	}, nil
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	nonce, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode nonce: %w", err)
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}
	return string(plaintext), nil
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}
