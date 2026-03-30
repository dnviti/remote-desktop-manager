package authservice

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s Service) VerifyEmail(ctx context.Context, token string) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}

	token = strings.TrimSpace(token)
	if len(token) != 64 {
		return &requestError{status: http.StatusBadRequest, message: "Invalid verification link."}
	}

	var (
		userID        string
		emailVerified bool
		emailExpiry   *time.Time
	)
	err := s.DB.QueryRow(ctx, `
SELECT id, COALESCE("emailVerified", false), "emailVerifyExpiry"
FROM "User"
WHERE "emailVerifyToken" = $1
`, token).Scan(&userID, &emailVerified, &emailExpiry)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusBadRequest, message: "Invalid or expired verification link."}
		}
		return fmt.Errorf("load verification token: %w", err)
	}

	if emailVerified {
		return nil
	}
	if emailExpiry == nil || emailExpiry.Before(time.Now()) {
		return &requestError{status: http.StatusBadRequest, message: "Verification link has expired. Please request a new one."}
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "User"
SET "emailVerified" = true,
    "emailVerifyToken" = NULL,
    "emailVerifyExpiry" = NULL,
    "updatedAt" = NOW()
WHERE id = $1
`, userID); err != nil {
		return fmt.Errorf("verify email: %w", err)
	}

	return nil
}

func (s Service) ResendVerification(ctx context.Context, email string) error {
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
		userID          string
		emailVerified   bool
		emailVerifyExpiry *time.Time
	)
	err := s.DB.QueryRow(ctx, `
SELECT id, COALESCE("emailVerified", false), "emailVerifyExpiry"
FROM "User"
WHERE email = $1
`, email).Scan(&userID, &emailVerified, &emailVerifyExpiry)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil
		}
		return fmt.Errorf("load resend verification user: %w", err)
	}

	if emailVerified {
		return nil
	}

	if emailVerifyExpiry != nil {
		tokenCreatedAt := emailVerifyExpiry.Add(-time.Duration(emailVerifyTTL) * time.Second)
		if time.Since(tokenCreatedAt) < time.Duration(resendCooldownSec)*time.Second {
			return nil
		}
	}

	token, err := randomHexToken(32)
	if err != nil {
		return fmt.Errorf("generate email verification token: %w", err)
	}
	expiry := time.Now().Add(time.Duration(emailVerifyTTL) * time.Second)

	if _, err := s.DB.Exec(ctx, `
UPDATE "User"
SET "emailVerifyToken" = $2,
    "emailVerifyExpiry" = $3,
    "updatedAt" = NOW()
WHERE id = $1
`, userID, token, expiry); err != nil {
		return fmt.Errorf("update email verification token: %w", err)
	}

	s.logVerificationEmail(email, token)
	return nil
}

func randomHexToken(size int) (string, error) {
	buf := make([]byte, size)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return hex.EncodeToString(buf), nil
}
