package authservice

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"os"
	"strings"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type registerResult struct {
	Message             string `json:"message"`
	UserID              string `json:"userId"`
	EmailVerifyRequired bool   `json:"emailVerifyRequired"`
	RecoveryKey         string `json:"recoveryKey"`
}

func (s Service) Register(ctx context.Context, email, password, ipAddress string) (registerResult, error) {
	if s.DB == nil {
		return registerResult{}, fmt.Errorf("postgres is not configured")
	}
	if s.EmailVerify {
		return registerResult{}, ErrLegacyRegister
	}

	email = strings.TrimSpace(strings.ToLower(email))
	if email == "" || password == "" {
		return registerResult{}, &requestError{status: http.StatusBadRequest, message: "Email and password are required"}
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return registerResult{}, &requestError{status: http.StatusBadRequest, message: "Invalid email format"}
	}

	enabled, err := s.getSelfSignupEnabled(ctx)
	if err != nil {
		return registerResult{}, err
	}
	if !enabled {
		return registerResult{}, &requestError{status: http.StatusForbidden, message: "Registration is currently disabled. Contact your administrator."}
	}

	var existingID string
	err = s.DB.QueryRow(ctx, `SELECT id FROM "User" WHERE email = $1`, email).Scan(&existingID)
	switch {
	case err == nil:
		return registerResult{
			Message:             "Registration successful. You can now log in.",
			UserID:              existingID,
			EmailVerifyRequired: false,
			RecoveryKey:         "",
		}, nil
	case !errors.Is(err, pgx.ErrNoRows):
		return registerResult{}, fmt.Errorf("query existing user: %w", err)
	}

	if err := assertPasswordNotBreached(ctx, password); err != nil {
		return registerResult{}, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(password), 12)
	if err != nil {
		return registerResult{}, fmt.Errorf("hash password: %w", err)
	}

	vaultSalt := generateSalt()
	masterKey := generateMasterKey()
	defer zeroBytes(masterKey)

	derivedKey := deriveKeyFromPassword(password, vaultSalt)
	if len(derivedKey) != 32 {
		return registerResult{}, fmt.Errorf("derive vault key: invalid derived key")
	}
	defer zeroBytes(derivedKey)

	encryptedVault, err := encryptMasterKey(masterKey, derivedKey)
	if err != nil {
		return registerResult{}, fmt.Errorf("encrypt vault key: %w", err)
	}

	recoveryKey, err := generateRecoveryKey()
	if err != nil {
		return registerResult{}, fmt.Errorf("generate recovery key: %w", err)
	}
	recoverySalt := generateSalt()
	recoveryDerived := deriveKeyFromPassword(recoveryKey, recoverySalt)
	if len(recoveryDerived) != 32 {
		return registerResult{}, fmt.Errorf("derive recovery key: invalid derived key")
	}
	defer zeroBytes(recoveryDerived)

	encryptedRecovery, err := encryptMasterKey(masterKey, recoveryDerived)
	if err != nil {
		return registerResult{}, fmt.Errorf("encrypt recovery key: %w", err)
	}

	var userID string
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "User" (
	email,
	"passwordHash",
	"vaultSalt",
	"encryptedVaultKey",
	"vaultKeyIV",
	"vaultKeyTag",
	"encryptedVaultRecoveryKey",
	"vaultRecoveryKeyIV",
	"vaultRecoveryKeyTag",
	"vaultRecoveryKeySalt",
	"emailVerified"
)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, true)
RETURNING id
`,
		email,
		string(passwordHash),
		vaultSalt,
		encryptedVault.Ciphertext,
		encryptedVault.IV,
		encryptedVault.Tag,
		encryptedRecovery.Ciphertext,
		encryptedRecovery.IV,
		encryptedRecovery.Tag,
		recoverySalt,
	).Scan(&userID); err != nil {
		return registerResult{}, fmt.Errorf("create user: %w", err)
	}

	_ = s.insertStandaloneAuditLog(ctx, &userID, "REGISTER", map[string]any{}, ipAddress)
	return registerResult{
		Message:             "Registration successful. You can now log in.",
		UserID:              userID,
		EmailVerifyRequired: false,
		RecoveryKey:         recoveryKey,
	}, nil
}

func (s Service) getSelfSignupEnabled(ctx context.Context) (bool, error) {
	if os.Getenv("SELF_SIGNUP_ENABLED") != "true" {
		return false, nil
	}
	if s.DB == nil {
		return true, nil
	}

	var value string
	err := s.DB.QueryRow(ctx, `SELECT value FROM "AppConfig" WHERE key = 'selfSignupEnabled'`).Scan(&value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		return false, fmt.Errorf("query self-signup flag: %w", err)
	}
	return strings.EqualFold(strings.TrimSpace(value), "true"), nil
}
