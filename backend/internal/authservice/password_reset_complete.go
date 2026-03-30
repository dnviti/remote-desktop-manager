package authservice

import (
	"context"
	"encoding/hex"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type passwordResetUser struct {
	ID                        string
	PasswordResetExpiry       *time.Time
	SMSMFAEnabled             bool
	PhoneVerified             bool
	PhoneNumber               string
	EncryptedVaultRecoveryKey *string
	VaultRecoveryKeyIV        *string
	VaultRecoveryKeyTag       *string
	VaultRecoveryKeySalt      *string
}

func (s Service) CompletePasswordReset(ctx context.Context, token, newPassword, smsCode, recoveryKey, ipAddress string) (map[string]any, error) {
	user, err := s.loadPasswordResetUser(ctx, hashToken(token))
	if err != nil {
		return nil, err
	}
	if user.ID == "" || user.PasswordResetExpiry == nil || user.PasswordResetExpiry.Before(time.Now()) {
		_ = s.insertStandaloneAuditLog(ctx, nil, "PASSWORD_RESET_FAILURE", map[string]any{
			"reason": "invalid_or_expired_token",
		}, ipAddress)
		return nil, &requestError{status: http.StatusBadRequest, message: "Invalid or expired reset token"}
	}

	if user.SMSMFAEnabled && user.PhoneVerified && user.PhoneNumber != "" {
		if smsCode == "" {
			return nil, &requestError{status: http.StatusUnauthorized, message: "SMS verification code is required"}
		}
		valid, err := s.verifyOTP(ctx, user.ID, smsCode)
		if err != nil {
			return nil, err
		}
		if !valid {
			_ = s.insertStandaloneAuditLog(ctx, &user.ID, "PASSWORD_RESET_FAILURE", map[string]any{
				"reason": "invalid_sms_code",
			}, ipAddress)
			return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired SMS code"}
		}
	}

	if err := assertPasswordNotBreached(ctx, newPassword); err != nil {
		return nil, err
	}
	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), 12)
	if err != nil {
		return nil, fmt.Errorf("hash password: %w", err)
	}

	vaultPreserved := false
	newRecoveryKey := ""

	if recoveryKey != "" &&
		user.EncryptedVaultRecoveryKey != nil &&
		user.VaultRecoveryKeyIV != nil &&
		user.VaultRecoveryKeyTag != nil &&
		user.VaultRecoveryKeySalt != nil &&
		*user.EncryptedVaultRecoveryKey != "" &&
		*user.VaultRecoveryKeyIV != "" &&
		*user.VaultRecoveryKeyTag != "" &&
		*user.VaultRecoveryKeySalt != "" {
		masterKey, err := decryptMasterKeyWithRecovery(
			encryptedField{
				Ciphertext: *user.EncryptedVaultRecoveryKey,
				IV:         *user.VaultRecoveryKeyIV,
				Tag:        *user.VaultRecoveryKeyTag,
			},
			recoveryKey,
			*user.VaultRecoveryKeySalt,
		)
		if err == nil {
			defer zeroBytes(masterKey)

			newVaultSalt := generateSalt()
			newDerived := deriveKeyFromPassword(newPassword, newVaultSalt)
			if len(newDerived) != 32 {
				return nil, fmt.Errorf("derive new vault key: invalid derived key")
			}
			defer zeroBytes(newDerived)

			encryptedVault, err := encryptMasterKey(masterKey, newDerived)
			if err != nil {
				return nil, fmt.Errorf("encrypt vault key: %w", err)
			}

			newRecoveryKey, err = generateRecoveryKey()
			if err != nil {
				return nil, fmt.Errorf("generate recovery key: %w", err)
			}
			recoverySalt := generateSalt()
			recoveryDerived := deriveKeyFromPassword(newRecoveryKey, recoverySalt)
			if len(recoveryDerived) != 32 {
				return nil, fmt.Errorf("derive recovery key: invalid derived key")
			}
			defer zeroBytes(recoveryDerived)

			encryptedRecovery, err := encryptMasterKey(masterKey, recoveryDerived)
			if err != nil {
				return nil, fmt.Errorf("encrypt recovery key: %w", err)
			}

			if _, err := s.DB.Exec(
				ctx,
				`UPDATE "User"
				    SET "passwordHash" = $2,
				        "vaultSalt" = $3,
				        "encryptedVaultKey" = $4,
				        "vaultKeyIV" = $5,
				        "vaultKeyTag" = $6,
				        "encryptedVaultRecoveryKey" = $7,
				        "vaultRecoveryKeyIV" = $8,
				        "vaultRecoveryKeyTag" = $9,
				        "vaultRecoveryKeySalt" = $10,
				        "vaultNeedsRecovery" = false,
				        "passwordResetTokenHash" = NULL,
				        "passwordResetExpiry" = NULL,
				        "updatedAt" = NOW()
				  WHERE id = $1`,
				user.ID,
				string(passwordHash),
				newVaultSalt,
				encryptedVault.Ciphertext,
				encryptedVault.IV,
				encryptedVault.Tag,
				encryptedRecovery.Ciphertext,
				encryptedRecovery.IV,
				encryptedRecovery.Tag,
				recoverySalt,
			); err != nil {
				return nil, fmt.Errorf("update password reset with recovery: %w", err)
			}
			vaultPreserved = true
		}
	}

	if !vaultPreserved {
		if _, err := s.DB.Exec(
			ctx,
			`UPDATE "User"
			    SET "passwordHash" = $2,
			        "vaultNeedsRecovery" = true,
			        "passwordResetTokenHash" = NULL,
			        "passwordResetExpiry" = NULL,
			        "updatedAt" = NOW()
			  WHERE id = $1`,
			user.ID,
			string(passwordHash),
		); err != nil {
			return nil, fmt.Errorf("update password reset state: %w", err)
		}
		_ = s.insertStandaloneAuditLog(ctx, &user.ID, "VAULT_NEEDS_RECOVERY", map[string]any{
			"reason": "password_reset_without_recovery_key",
		}, ipAddress)
	}

	if _, err := s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "userId" = $1`, user.ID); err != nil {
		return nil, fmt.Errorf("delete refresh tokens: %w", err)
	}
	if err := s.clearVaultSessions(ctx, user.ID); err != nil {
		return nil, err
	}

	_ = s.insertStandaloneAuditLog(ctx, &user.ID, "PASSWORD_RESET_COMPLETE", map[string]any{
		"vaultPreserved": vaultPreserved,
	}, ipAddress)

	result := map[string]any{
		"success":        true,
		"vaultPreserved": vaultPreserved,
	}
	if newRecoveryKey != "" {
		result["newRecoveryKey"] = newRecoveryKey
	}
	return result, nil
}

func (s Service) loadPasswordResetUser(ctx context.Context, tokenHash string) (passwordResetUser, error) {
	if s.DB == nil {
		return passwordResetUser{}, fmt.Errorf("postgres is not configured")
	}

	var user passwordResetUser
	err := s.DB.QueryRow(
		ctx,
		`SELECT id,
		        "passwordResetExpiry",
		        COALESCE("smsMfaEnabled", false),
		        COALESCE("phoneVerified", false),
		        COALESCE("phoneNumber", ''),
		        "encryptedVaultRecoveryKey",
		        "vaultRecoveryKeyIV",
		        "vaultRecoveryKeyTag",
		        "vaultRecoveryKeySalt"
		   FROM "User"
		  WHERE "passwordResetTokenHash" = $1`,
		tokenHash,
	).Scan(
		&user.ID,
		&user.PasswordResetExpiry,
		&user.SMSMFAEnabled,
		&user.PhoneVerified,
		&user.PhoneNumber,
		&user.EncryptedVaultRecoveryKey,
		&user.VaultRecoveryKeyIV,
		&user.VaultRecoveryKeyTag,
		&user.VaultRecoveryKeySalt,
	)
	if err != nil {
		if err == pgx.ErrNoRows {
			return passwordResetUser{}, nil
		}
		return passwordResetUser{}, fmt.Errorf("load password reset user: %w", err)
	}
	return user, nil
}

func decryptMasterKeyWithRecovery(field encryptedField, recoveryKey, salt string) ([]byte, error) {
	derived := deriveKeyFromPassword(recoveryKey, salt)
	if len(derived) == 0 {
		return nil, fmt.Errorf("invalid recovery salt")
	}
	defer zeroBytes(derived)

	hexKey, err := decryptEncryptedField(derived, field)
	if err != nil {
		return nil, err
	}
	defer zeroString(&hexKey)
	return hex.DecodeString(hexKey)
}

func (s Service) clearVaultSessions(ctx context.Context, userID string) error {
	if s.Redis == nil {
		return nil
	}
	if err := s.Redis.Del(ctx, "vault:user:"+userID, "vault:recovery:"+userID).Err(); err != nil {
		return fmt.Errorf("clear vault sessions: %w", err)
	}
	return nil
}
