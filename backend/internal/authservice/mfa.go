package authservice

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type mfaUser struct {
	ID                  string
	Email               string
	TOTPEnabled         bool
	EncryptedTOTPSecret *string
	TOTPSecretIV        *string
	TOTPSecretTag       *string
	TOTPSecret          *string
}

func (s Service) VerifyTOTP(ctx context.Context, tempToken, code, ipAddress, userAgent string) (issuedLogin, error) {
	if s.DB == nil {
		return issuedLogin{}, fmt.Errorf("postgres is not configured")
	}
	if len(s.JWTSecret) == 0 {
		return issuedLogin{}, fmt.Errorf("JWT secret is not configured")
	}

	userID, purpose, err := s.parseMFATempToken(tempToken)
	if err != nil {
		return issuedLogin{}, err
	}
	if purpose != "totp-verify" && purpose != "mfa-verify" {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}
	if err := s.enforceLoginMFARateLimit(ctx, userID, ipAddress); err != nil {
		return issuedLogin{}, err
	}
	if err := validateTOTPCode(code); err != nil {
		return issuedLogin{}, err
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
		}
		return issuedLogin{}, err
	}

	mfaUser, err := s.loadMFAUser(ctx, user.ID)
	if err != nil {
		return issuedLogin{}, err
	}
	if !mfaUser.TOTPEnabled {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
	}

	secret, err := s.resolveTOTPSecret(ctx, mfaUser)
	if err != nil {
		return issuedLogin{}, err
	}
	if !verifyTOTP(secret, code, time.Now()) {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Invalid TOTP code"}
	}

	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return issuedLogin{}, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, err
	}
	_ = s.insertStandaloneAuditLogWithFlags(ctx, &user.ID, "LOGIN_TOTP", map[string]any{}, ipAddress, allowlistDecision.Flags())
	return result, nil
}

func (s Service) parseMFATempToken(tempToken string) (string, string, error) {
	token, err := jwt.Parse(tempToken, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return s.JWTSecret, nil
	})
	if err != nil || !token.Valid {
		return "", "", &requestError{status: http.StatusUnauthorized, message: "Invalid or expired temporary token"}
	}

	claims, ok := token.Claims.(jwt.MapClaims)
	if !ok {
		return "", "", &requestError{status: http.StatusUnauthorized, message: "Invalid or expired temporary token"}
	}

	userID, _ := claims["userId"].(string)
	purpose, _ := claims["purpose"].(string)
	if strings.TrimSpace(userID) == "" {
		return "", "", &requestError{status: http.StatusUnauthorized, message: "Invalid or expired temporary token"}
	}
	return userID, purpose, nil
}

func validateTOTPCode(code string) error {
	code = strings.TrimSpace(code)
	if len(code) != 6 {
		return &requestError{status: http.StatusBadRequest, message: "Invalid code format"}
	}
	for _, ch := range code {
		if ch < '0' || ch > '9' {
			return &requestError{status: http.StatusBadRequest, message: "Invalid code format"}
		}
	}
	return nil
}

func (s Service) loadMFAUser(ctx context.Context, userID string) (mfaUser, error) {
	var user mfaUser
	err := s.DB.QueryRow(
		ctx,
		`SELECT id,
		        email,
		        COALESCE("totpEnabled", false),
		        "encryptedTotpSecret",
		        "totpSecretIV",
		        "totpSecretTag",
		        "totpSecret"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&user.ID,
		&user.Email,
		&user.TOTPEnabled,
		&user.EncryptedTOTPSecret,
		&user.TOTPSecretIV,
		&user.TOTPSecretTag,
		&user.TOTPSecret,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return mfaUser{}, &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
		}
		return mfaUser{}, fmt.Errorf("load MFA user: %w", err)
	}
	return user, nil
}

func (s Service) resolveTOTPSecret(ctx context.Context, user mfaUser) (string, error) {
	if user.TOTPSecret != nil && strings.TrimSpace(*user.TOTPSecret) != "" {
		return strings.TrimSpace(*user.TOTPSecret), nil
	}
	if user.EncryptedTOTPSecret == nil || user.TOTPSecretIV == nil || user.TOTPSecretTag == nil ||
		*user.EncryptedTOTPSecret == "" || *user.TOTPSecretIV == "" || *user.TOTPSecretTag == "" {
		return "", &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
	}

	masterKey, err := s.loadVaultMasterKey(ctx, user.ID)
	if err != nil {
		return "", err
	}
	if len(masterKey) == 0 {
		return "", &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
	}
	defer zeroBytes(masterKey)

	secret, err := decryptEncryptedField(masterKey, encryptedField{
		Ciphertext: *user.EncryptedTOTPSecret,
		IV:         *user.TOTPSecretIV,
		Tag:        *user.TOTPSecretTag,
	})
	if err != nil {
		return "", &requestError{status: http.StatusUnauthorized, message: "2FA verification failed"}
	}
	return secret, nil
}

func (s Service) loadVaultMasterKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerKey) == 0 {
		return nil, nil
	}
	for _, key := range []string{"vault:user:" + userID, "vault:recovery:" + userID} {
		raw, err := s.Redis.Get(ctx, key).Bytes()
		switch {
		case err == nil:
			var field encryptedField
			if err := json.Unmarshal(raw, &field); err != nil {
				return nil, fmt.Errorf("decode vault session: %w", err)
			}
			masterKeyHex, err := decryptEncryptedField(s.ServerKey, field)
			if err != nil {
				return nil, fmt.Errorf("decrypt vault session: %w", err)
			}
			defer zeroString(&masterKeyHex)
			masterKey, err := hex.DecodeString(masterKeyHex)
			if err != nil {
				return nil, fmt.Errorf("decode vault session key: %w", err)
			}
			return masterKey, nil
		case err == redis.Nil:
			continue
		default:
			return nil, fmt.Errorf("load vault session: %w", err)
		}
	}
	return nil, nil
}

func verifyTOTP(secret, code string, now time.Time) bool {
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		return false
	}
	counter := now.UTC().Unix() / 30
	for _, offset := range []int64{-1, 0, 1} {
		if generateTOTPCode(key, counter+offset) == code {
			return true
		}
	}
	return false
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.TrimSpace(secret))
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	cleaned = strings.ReplaceAll(cleaned, "-", "")
	decoder := base32.StdEncoding.WithPadding(base32.NoPadding)
	return decoder.DecodeString(cleaned)
}

func generateTOTPCode(key []byte, counter int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := int(binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff)
	return fmt.Sprintf("%06d", value%1_000_000)
}
