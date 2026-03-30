package mfaapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) loadTOTPUser(ctx context.Context, userID string) (totpUser, error) {
	if s.DB == nil {
		return totpUser{}, fmt.Errorf("database is unavailable")
	}

	var user totpUser
	err := s.DB.QueryRow(
		ctx,
		`SELECT id, email, COALESCE("totpEnabled", false), "encryptedTotpSecret", "totpSecretIV", "totpSecretTag", "totpSecret"
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
		if errors.Is(err, pgx.ErrNoRows) {
			return totpUser{}, requestErr(404, "User not found")
		}
		return totpUser{}, fmt.Errorf("load totp user: %w", err)
	}
	return user, nil
}

func (s Service) storeSetupSecret(ctx context.Context, userID string, field encryptedField) error {
	_, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "encryptedTotpSecret" = $2,
		        "totpSecretIV" = $3,
		        "totpSecretTag" = $4,
		        "totpSecret" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		field.Ciphertext,
		field.IV,
		field.Tag,
	)
	if err != nil {
		return fmt.Errorf("store setup secret: %w", err)
	}
	return nil
}

func (s Service) enableTOTP(ctx context.Context, user totpUser, secret string, masterKey []byte) error {
	if user.TOTPSecret != nil && *user.TOTPSecret != "" {
		enc, err := encryptValue(masterKey, secret)
		if err != nil {
			return fmt.Errorf("encrypt totp secret: %w", err)
		}
		_, err = s.DB.Exec(
			ctx,
			`UPDATE "User"
			    SET "totpEnabled" = true,
			        "encryptedTotpSecret" = $2,
			        "totpSecretIV" = $3,
			        "totpSecretTag" = $4,
			        "totpSecret" = NULL,
			        "updatedAt" = NOW()
			  WHERE id = $1`,
			user.ID,
			enc.Ciphertext,
			enc.IV,
			enc.Tag,
		)
		if err != nil {
			return fmt.Errorf("enable totp: %w", err)
		}
		return nil
	}

	_, err := s.DB.Exec(
		ctx,
		`UPDATE "User" SET "totpEnabled" = true, "updatedAt" = NOW() WHERE id = $1`,
		user.ID,
	)
	if err != nil {
		return fmt.Errorf("enable totp: %w", err)
	}
	return nil
}

func (s Service) disableTOTP(ctx context.Context, userID string) error {
	_, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "totpEnabled" = false,
		        "totpSecret" = NULL,
		        "encryptedTotpSecret" = NULL,
		        "totpSecretIV" = NULL,
		        "totpSecretTag" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	)
	if err != nil {
		return fmt.Errorf("disable totp: %w", err)
	}
	return nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, ipAddress string) error {
	rawDetails, err := json.Marshal(map[string]any{})
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "ipAddress", "createdAt"
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, NULLIF($5, ''), $6
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		ipAddress,
		time.Now(),
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}
