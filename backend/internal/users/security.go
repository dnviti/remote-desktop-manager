package users

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

func (s Service) putVerificationSession(ctx context.Context, verificationID string, session verificationSession, ttl time.Duration) error {
	if s.Redis == nil {
		return fmt.Errorf("redis is not configured")
	}
	payload, err := json.Marshal(session)
	if err != nil {
		return fmt.Errorf("marshal verification session: %w", err)
	}
	encoded := base64.StdEncoding.EncodeToString(payload)
	if err := s.Redis.Set(ctx, verificationSessionKeyPrefix+verificationID, encoded, ttl).Err(); err != nil {
		return fmt.Errorf("store verification session: %w", err)
	}
	return nil
}

func (s Service) getVerificationSession(ctx context.Context, verificationID string) (verificationSession, bool, error) {
	if s.Redis == nil {
		return verificationSession{}, false, fmt.Errorf("redis is not configured")
	}
	value, err := s.Redis.Get(ctx, verificationSessionKeyPrefix+verificationID).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return verificationSession{}, false, nil
		}
		return verificationSession{}, false, fmt.Errorf("load verification session: %w", err)
	}
	payload, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return verificationSession{}, false, fmt.Errorf("decode verification session: %w", err)
	}
	var session verificationSession
	if err := json.Unmarshal(payload, &session); err != nil {
		return verificationSession{}, false, fmt.Errorf("unmarshal verification session: %w", err)
	}
	return session, true, nil
}

func (s Service) deleteVerificationSession(ctx context.Context, verificationID string) error {
	if s.Redis == nil {
		return fmt.Errorf("redis is not configured")
	}
	if err := s.Redis.Del(ctx, verificationSessionKeyPrefix+verificationID).Err(); err != nil {
		return fmt.Errorf("delete verification session: %w", err)
	}
	return nil
}

func (s Service) verifyPassword(ctx context.Context, userID, password string) (bool, error) {
	if s.DB == nil {
		return false, fmt.Errorf("postgres is not configured")
	}
	var passwordHash *string
	if err := s.DB.QueryRow(ctx, `SELECT "passwordHash" FROM "User" WHERE id = $1`, userID).Scan(&passwordHash); err != nil {
		return false, err
	}
	if passwordHash == nil || *passwordHash == "" {
		return false, &requestError{status: http.StatusBadRequest, message: "No password set."}
	}
	return bcrypt.CompareHashAndPassword([]byte(*passwordHash), []byte(password)) == nil, nil
}

func (s Service) consumeVerificationSession(ctx context.Context, verificationID, userID, purpose string) error {
	session, found, err := s.getVerificationSession(ctx, verificationID)
	if err != nil {
		return err
	}
	if !found {
		return ErrLegacyEmailChangeFlow
	}
	if !session.Confirmed {
		return &requestError{status: http.StatusBadRequest, message: "Verification not yet confirmed."}
	}
	if session.UserID != userID {
		return &requestError{status: http.StatusForbidden, message: "Verification session mismatch."}
	}
	if session.Purpose != purpose {
		return &requestError{status: http.StatusForbidden, message: "Verification purpose mismatch."}
	}
	if session.ExpiresAt < time.Now().UnixMilli() {
		_ = s.deleteVerificationSession(ctx, verificationID)
		return &requestError{status: http.StatusBadRequest, message: "Verification expired. Please start a new verification."}
	}
	return s.deleteVerificationSession(ctx, verificationID)
}

func (s Service) getVaultMasterKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, nil
	}

	key := "vault:user:" + userID
	payload, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault session: %w", err)
	}

	var field encryptedField
	normalized, err := rediscompat.DecodeJSONPayload(payload, &field)
	if err != nil {
		return nil, fmt.Errorf("decode vault session payload: %w", err)
	}

	hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault session: %w", err)
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode vault master key: %w", err)
	}

	if ttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && ttl > 0 {
		_ = s.Redis.Set(ctx, key, normalized, ttl).Err()
	}

	return masterKey, nil
}

func deriveKeyFromPassword(password, saltHex string) []byte {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil
	}
	return argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
}

func generateSalt() string {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate salt: %w", err))
	}
	return hex.EncodeToString(buf)
}

func generateRecoveryKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func encryptMasterKey(masterKey, derivedKey []byte) (encryptedField, error) {
	if len(derivedKey) != 32 {
		return encryptedField{}, fmt.Errorf("derived key must be 32 bytes")
	}

	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}

	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}

	ciphertextWithTag := aead.Seal(nil, iv, []byte(hex.EncodeToString(masterKey)), nil)
	tagSize := aead.Overhead()
	if len(ciphertextWithTag) < tagSize {
		return encryptedField{}, fmt.Errorf("encrypted payload too short")
	}
	ciphertext := ciphertextWithTag[:len(ciphertextWithTag)-tagSize]
	tag := ciphertextWithTag[len(ciphertextWithTag)-tagSize:]

	return encryptedField{
		Ciphertext: hex.EncodeToString(ciphertext),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(tag),
	}, nil
}

func decryptMasterKey(field encryptedField, derivedKey []byte) ([]byte, error) {
	hexKey, err := decryptEncryptedField(derivedKey, field)
	if err != nil {
		return nil, err
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, err
	}
	return masterKey, nil
}

func assertPasswordNotBreached(ctx context.Context, password string) error {
	sum := sha1.Sum([]byte(password))
	sha1Hex := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix := sha1Hex[:5]
	suffix := sha1Hex[5:]

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, hibpAPIURL+prefix, nil)
	if err != nil {
		return fmt.Errorf("prepare hibp request: %w", err)
	}
	req.Header.Set("User-Agent", hibpUserAgent)

	client := &http.Client{Timeout: hibpTimeout}
	resp, err := client.Do(req)
	if err != nil {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}
	for _, line := range strings.Split(string(body), "\r\n") {
		hashSuffix, _, found := strings.Cut(line, ":")
		if found && hashSuffix == suffix {
			return &requestError{status: http.StatusBadRequest, message: "This password has appeared in a known data breach. Please choose a different password."}
		}
	}
	return nil
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	iv, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}

	plaintext, err := aead.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}

	return string(plaintext), nil
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, action string, details map[string]any, ipAddress string) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "ipAddress"
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, NULLIF($5, '')
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		ipAddress,
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}

	return nil
}
