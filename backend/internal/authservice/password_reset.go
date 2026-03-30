package authservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type resetValidationResult struct {
	Valid                   bool    `json:"valid"`
	RequiresSMSVerification bool    `json:"requiresSmsVerification"`
	MaskedPhone             *string `json:"maskedPhone,omitempty"`
	HasRecoveryKey          bool    `json:"hasRecoveryKey"`
}

func (s Service) ForgotPassword(ctx context.Context, email, ipAddress string) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}
	if emailFlowConfigured() {
		return ErrLegacyEmailFlow
	}

	email = strings.TrimSpace(strings.ToLower(email))
	if _, err := mail.ParseAddress(email); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "Invalid email format"}
	}

	var (
		userID       string
		passwordHash *string
		lockedUntil  *time.Time
	)
	err := s.DB.QueryRow(ctx, `
SELECT id, "passwordHash", "lockedUntil"
FROM "User"
WHERE email = $1
`, email).Scan(&userID, &passwordHash, &lockedUntil)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load forgot password user: %w", err)
	}

	if passwordHash == nil || strings.TrimSpace(*passwordHash) == "" {
		return nil
	}
	if lockedUntil != nil && lockedUntil.After(time.Now()) {
		return nil
	}

	token, err := randomHexToken(32)
	if err != nil {
		return fmt.Errorf("generate password reset token: %w", err)
	}
	tokenHash := hashToken(token)
	expiry := time.Now().Add(time.Duration(passwordResetTTL) * time.Second)

	if _, err := s.DB.Exec(ctx, `
UPDATE "User"
SET "passwordResetTokenHash" = $2,
    "passwordResetExpiry" = $3,
    "updatedAt" = NOW()
WHERE id = $1
`, userID, tokenHash, expiry); err != nil {
		return fmt.Errorf("store password reset token: %w", err)
	}

	s.logPasswordResetEmail(email, token)
	_ = s.insertStandaloneAuditLog(ctx, &userID, "PASSWORD_RESET_REQUEST", map[string]any{"email": email}, ipAddress)
	return nil
}

func (s Service) ValidateResetToken(ctx context.Context, token string) (resetValidationResult, error) {
	if s.DB == nil {
		return resetValidationResult{}, fmt.Errorf("postgres is not configured")
	}

	token = strings.TrimSpace(token)
	if len(token) != 64 {
		return resetValidationResult{Valid: false, RequiresSMSVerification: false, HasRecoveryKey: false}, nil
	}
	tokenHash := hashToken(token)

	var (
		userID               string
		passwordResetExpiry  *time.Time
		smsMfaEnabled        bool
		phoneVerified        bool
		phoneNumber          *string
		encryptedRecoveryKey *string
	)
	err := s.DB.QueryRow(ctx, `
SELECT id,
       "passwordResetExpiry",
       COALESCE("smsMfaEnabled", false),
       COALESCE("phoneVerified", false),
       "phoneNumber",
       "encryptedVaultRecoveryKey"
FROM "User"
WHERE "passwordResetTokenHash" = $1
`, tokenHash).Scan(
		&userID,
		&passwordResetExpiry,
		&smsMfaEnabled,
		&phoneVerified,
		&phoneNumber,
		&encryptedRecoveryKey,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return resetValidationResult{Valid: false, RequiresSMSVerification: false, HasRecoveryKey: false}, nil
		}
		return resetValidationResult{}, fmt.Errorf("validate reset token: %w", err)
	}

	if passwordResetExpiry == nil || passwordResetExpiry.Before(time.Now()) {
		return resetValidationResult{Valid: false, RequiresSMSVerification: false, HasRecoveryKey: false}, nil
	}

	requiresSMS := smsMfaEnabled && phoneVerified && phoneNumber != nil && strings.TrimSpace(*phoneNumber) != ""
	result := resetValidationResult{
		Valid:                   true,
		RequiresSMSVerification: requiresSMS,
		HasRecoveryKey:          encryptedRecoveryKey != nil && strings.TrimSpace(*encryptedRecoveryKey) != "",
	}
	if requiresSMS {
		masked := maskPhone(*phoneNumber)
		result.MaskedPhone = &masked
	}

	return result, nil
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func maskPhone(phone string) string {
	if len(phone) <= 4 {
		return "****"
	}
	return strings.Repeat("*", len(phone)-4) + phone[len(phone)-4:]
}
