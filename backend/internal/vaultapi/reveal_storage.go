package vaultapi

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type revealCredentialRecord struct {
	RequiresLegacy bool
	Password       *encryptedField
}

type notFoundError string

func (e notFoundError) Error() string {
	return string(e)
}

func (s Service) loadVaultSession(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerKey) != 32 {
		return nil, nil
	}
	raw, err := s.Redis.Get(ctx, "vault:user:"+userID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault session: %w", err)
	}

	var field encryptedField
	if err := json.Unmarshal(raw, &field); err != nil {
		return nil, fmt.Errorf("decode vault session: %w", err)
	}
	hexKey, err := decryptEncryptedField(s.ServerKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault session: %w", err)
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode vault session key: %w", err)
	}
	if ttl, ttlErr := s.Redis.PTTL(ctx, "vault:user:"+userID).Result(); ttlErr == nil && ttl > 0 {
		_ = s.Redis.Set(ctx, "vault:user:"+userID, raw, ttl).Err()
	}
	return masterKey, nil
}

func (s Service) loadOwnedRevealCredential(ctx context.Context, connectionID, userID string) (revealCredentialRecord, error) {
	var credentialSecretID sql.NullString
	var encryptedPassword sql.NullString
	var passwordIV sql.NullString
	var passwordTag sql.NullString

	err := s.DB.QueryRow(ctx, `
SELECT
	"credentialSecretId",
	"encryptedPassword",
	"passwordIV",
	"passwordTag"
FROM "Connection"
WHERE id = $1
  AND "userId" = $2
`, connectionID, userID).Scan(&credentialSecretID, &encryptedPassword, &passwordIV, &passwordTag)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return revealCredentialRecord{}, notFoundError("owned reveal credential")
		}
		return revealCredentialRecord{}, fmt.Errorf("load owned reveal credential: %w", err)
	}
	return buildRevealCredentialRecord(credentialSecretID, encryptedPassword, passwordIV, passwordTag), nil
}

func (s Service) loadSharedRevealCredential(ctx context.Context, connectionID, userID string) (revealCredentialRecord, error) {
	var credentialSecretID sql.NullString
	var encryptedPassword sql.NullString
	var passwordIV sql.NullString
	var passwordTag sql.NullString

	err := s.DB.QueryRow(ctx, `
SELECT
	c."credentialSecretId",
	sc."encryptedPassword",
	sc."passwordIV",
	sc."passwordTag"
FROM "SharedConnection" sc
JOIN "Connection" c ON c.id = sc."connectionId"
WHERE sc."connectionId" = $1
  AND sc."sharedWithUserId" = $2
  AND sc.permission::text = 'FULL_ACCESS'
`, connectionID, userID).Scan(&credentialSecretID, &encryptedPassword, &passwordIV, &passwordTag)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return revealCredentialRecord{}, notFoundError("shared reveal credential")
		}
		return revealCredentialRecord{}, fmt.Errorf("load shared reveal credential: %w", err)
	}
	return buildRevealCredentialRecord(credentialSecretID, encryptedPassword, passwordIV, passwordTag), nil
}

func buildRevealCredentialRecord(credentialSecretID, encryptedPassword, passwordIV, passwordTag sql.NullString) revealCredentialRecord {
	record := revealCredentialRecord{}
	if credentialSecretID.Valid && credentialSecretID.String != "" {
		record.RequiresLegacy = true
		return record
	}
	if encryptedPassword.Valid && passwordIV.Valid && passwordTag.Valid {
		record.Password = &encryptedField{
			Ciphertext: encryptedPassword.String,
			IV:         passwordIV.String,
			Tag:        passwordTag.String,
		}
	}
	return record
}
