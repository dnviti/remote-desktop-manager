package vaultapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func (s Service) loadVaultRecovery(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerKey) != 32 {
		return nil, nil
	}
	raw, err := s.Redis.Get(ctx, "vault:recovery:"+userID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault recovery: %w", err)
	}

	var field encryptedField
	if err := json.Unmarshal(raw, &field); err != nil {
		return nil, fmt.Errorf("decode vault recovery: %w", err)
	}
	hexKey, err := decryptEncryptedField(s.ServerKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault recovery: %w", err)
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode vault recovery key: %w", err)
	}
	return masterKey, nil
}

func (s Service) loadTOTPUnlockUser(ctx context.Context, userID string) (totpUnlockUser, error) {
	if s.DB == nil {
		return totpUnlockUser{}, fmt.Errorf("database is unavailable")
	}

	var user totpUnlockUser
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE("totpEnabled", false),
		        "encryptedTotpSecret",
		        "totpSecretIV",
		        "totpSecretTag",
		        "totpSecret"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&user.TOTPEnabled,
		&user.EncryptedTOTPSecret,
		&user.TOTPSecretIV,
		&user.TOTPSecretTag,
		&user.TOTPSecret,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return totpUnlockUser{}, &requestError{status: 404, message: "User not found"}
		}
		return totpUnlockUser{}, fmt.Errorf("load TOTP settings: %w", err)
	}
	return user, nil
}
