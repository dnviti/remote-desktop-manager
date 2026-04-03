package authservice

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
)

const (
	loginMFARateLimitWindow      = time.Minute
	loginMFARateLimitMaxAttempts = 5
)

func (s Service) storeVaultSession(ctx context.Context, userID, password string, user loginUser) error {
	if s.Redis == nil || len(s.ServerKey) == 0 || s.VaultTTL <= 0 {
		return nil
	}
	if user.VaultSalt == nil || user.EncryptedVaultKey == nil || user.VaultKeyIV == nil || user.VaultKeyTag == nil ||
		*user.VaultSalt == "" || *user.EncryptedVaultKey == "" || *user.VaultKeyIV == "" || *user.VaultKeyTag == "" {
		return nil
	}

	derived := deriveKeyFromPassword(password, *user.VaultSalt)
	defer zeroBytes(derived)
	masterKeyHex, err := decryptEncryptedField(derived, encryptedField{
		Ciphertext: *user.EncryptedVaultKey,
		IV:         *user.VaultKeyIV,
		Tag:        *user.VaultKeyTag,
	})
	if err != nil {
		return fmt.Errorf("decrypt vault session: %w", err)
	}
	defer zeroString(&masterKeyHex)

	encrypted, err := encryptValue(s.ServerKey, masterKeyHex)
	if err != nil {
		return fmt.Errorf("encrypt vault session: %w", err)
	}
	raw, err := json.Marshal(encrypted)
	if err != nil {
		return fmt.Errorf("marshal vault session: %w", err)
	}
	if err := s.Redis.Set(ctx, "vault:user:"+userID, raw, s.VaultTTL).Err(); err != nil {
		return fmt.Errorf("store vault session: %w", err)
	}
	recoveryTTL := s.RefreshCookieTTL
	if recoveryTTL <= 0 {
		recoveryTTL = 7 * 24 * time.Hour
	}
	if err := s.Redis.Set(ctx, "vault:recovery:"+userID, raw, recoveryTTL).Err(); err != nil {
		return fmt.Errorf("store vault recovery: %w", err)
	}
	if s.TenantVaultService != nil {
		if err := s.TenantVaultService.ProcessPendingDistributionsForUser(ctx, userID); err != nil {
			return fmt.Errorf("process pending tenant vault distributions: %w", err)
		}
	}
	return nil
}

func (s Service) enforceSlidingWindowLimit(ctx context.Context, key string, window time.Duration, maxAttempts int, message string) error {
	if s.Redis == nil || strings.TrimSpace(key) == "" || window <= 0 || maxAttempts <= 0 {
		return nil
	}

	now := time.Now()
	windowMs := window.Milliseconds()
	windowStart := now.UnixMilli() / windowMs * windowMs
	windowEnd := windowStart + windowMs
	redisKey := fmt.Sprintf("%s:%d", key, windowStart)

	count, err := s.Redis.Incr(ctx, redisKey).Result()
	if err != nil {
		return fmt.Errorf("increment rate limit: %w", err)
	}

	ttl := time.Duration(windowEnd-now.UnixMilli()+1000) * time.Millisecond
	if ttl > 0 {
		_ = s.Redis.PExpire(ctx, redisKey, ttl).Err()
	}

	if count > int64(maxAttempts) {
		return &requestError{status: http.StatusTooManyRequests, message: message}
	}
	return nil
}

func (s Service) enforceLoginRateLimit(ctx context.Context, ipAddress string) error {
	ipAddress = normalizeIP(ipAddress)
	if ipAddress == "" {
		return nil
	}
	window := s.loginRateLimitWindow()
	maxAttempts := s.loginRateLimitMaxAttempts()
	return s.enforceSlidingWindowLimit(
		ctx,
		"rl:login:"+ipAddress,
		window,
		maxAttempts,
		"Too many login attempts. Please try again later.",
	)
}

func (s Service) enforceLoginMFARateLimit(ctx context.Context, userID, ipAddress string) error {
	identity := strings.TrimSpace(userID)
	if identity == "" {
		identity = normalizeIP(ipAddress)
	}
	if identity == "" {
		return nil
	}
	return s.enforceSlidingWindowLimit(
		ctx,
		"rl:login-mfa:"+identity,
		loginMFARateLimitWindow,
		loginMFARateLimitMaxAttempts,
		"Too many MFA verification attempts. Please try again later.",
	)
}

func (s Service) loginRateLimitWindow() time.Duration {
	if value := strings.TrimSpace(os.Getenv("LOGIN_RATE_LIMIT_WINDOW_MS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	return 15 * time.Minute
}

func (s Service) loginRateLimitMaxAttempts() int {
	if value := strings.TrimSpace(os.Getenv("LOGIN_RATE_LIMIT_MAX_ATTEMPTS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return 5
}

func deriveKeyFromPassword(password, saltHex string) []byte {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil
	}
	return argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	if len(key) != 32 {
		return "", fmt.Errorf("invalid key length")
	}
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

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	if len(key) != 32 {
		return encryptedField{}, fmt.Errorf("invalid key length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagOffset := len(sealed) - aead.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:tagOffset]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(sealed[tagOffset:]),
	}, nil
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		if ip := stripIP(value); ip != "" {
			return ip
		}
	}
	return ""
}

func hasCookies(r *http.Request) bool {
	return len(r.Cookies()) > 0
}

func firstForwardedFor(value string) string {
	for i, ch := range value {
		if ch == ',' {
			return value[:i]
		}
	}
	return value
}

func stripIP(value string) string {
	value = normalizeIP(value)
	if value == "" {
		return ""
	}
	return value
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	value = strings.TrimPrefix(value, "::ffff:")
	return value
}

func (s Service) insertStandaloneAuditLog(ctx context.Context, userID *string, action string, details map[string]any, ipAddress string) error {
	if s.DB == nil {
		return nil
	}
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := s.DB.Exec(
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

func (s Service) insertStandaloneAuditLogWithFlags(ctx context.Context, userID *string, action string, details map[string]any, ipAddress string, flags []string) error {
	if len(flags) == 0 {
		return s.insertStandaloneAuditLog(ctx, userID, action, details, ipAddress)
	}
	if s.DB == nil {
		return nil
	}

	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "ipAddress", flags
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, NULLIF($5, ''), $6::text[]
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		ipAddress,
		flags,
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID *string, action string, details map[string]any, ipAddress string) error {
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

func plural(value int) string {
	if value == 1 {
		return ""
	}
	return "s"
}

func zeroString(value *string) {
	if value == nil {
		return
	}
	*value = ""
}

func computeBindingHash(ipAddress, userAgent string) string {
	sum := sha256.Sum256([]byte(ipAddress + "|" + userAgent))
	return hex.EncodeToString(sum[:])
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

func DefaultCookieSecure() bool {
	value := os.Getenv("COOKIE_SECURE")
	if value == "false" {
		return false
	}
	return true
}
