package mfaapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s Service) GetTOTPStatus(ctx context.Context, userID string) (totpStatusResponse, error) {
	if s.DB == nil {
		return totpStatusResponse{}, fmt.Errorf("database is unavailable")
	}

	var enabled bool
	err := s.DB.QueryRow(ctx, `SELECT COALESCE("totpEnabled", false) FROM "User" WHERE id = $1`, userID).Scan(&enabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return totpStatusResponse{}, fmt.Errorf("user not found")
		}
		return totpStatusResponse{}, fmt.Errorf("get totp status: %w", err)
	}
	return totpStatusResponse{Enabled: enabled}, nil
}

func (s Service) GetSMSStatus(ctx context.Context, userID string) (smsStatusResponse, error) {
	if s.DB == nil {
		return smsStatusResponse{}, fmt.Errorf("database is unavailable")
	}

	var (
		enabled       bool
		phoneNumber   *string
		phoneVerified bool
	)
	err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE("smsMfaEnabled", false), "phoneNumber", COALESCE("phoneVerified", false)
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&enabled, &phoneNumber, &phoneVerified)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return smsStatusResponse{}, fmt.Errorf("user not found")
		}
		return smsStatusResponse{}, fmt.Errorf("get sms mfa status: %w", err)
	}

	var masked *string
	if phoneNumber != nil && strings.TrimSpace(*phoneNumber) != "" {
		value := maskPhone(*phoneNumber)
		masked = &value
	}

	return smsStatusResponse{
		Enabled:       enabled,
		PhoneNumber:   masked,
		PhoneVerified: phoneVerified,
	}, nil
}

func (s Service) GetWebAuthnStatus(ctx context.Context, userID string) (webauthnStatusResponse, error) {
	if s.DB == nil {
		return webauthnStatusResponse{}, fmt.Errorf("database is unavailable")
	}

	var result webauthnStatusResponse
	err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE(u."webauthnEnabled", false), COUNT(c.id)::int
		   FROM "User" u
		   LEFT JOIN "WebAuthnCredential" c ON c."userId" = u.id
		  WHERE u.id = $1
		  GROUP BY u.id, u."webauthnEnabled"`,
		userID,
	).Scan(&result.Enabled, &result.CredentialCount)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return webauthnStatusResponse{}, fmt.Errorf("user not found")
		}
		return webauthnStatusResponse{}, fmt.Errorf("get webauthn status: %w", err)
	}
	return result, nil
}

func (s Service) ListWebAuthnCredentials(ctx context.Context, userID string) ([]webauthnCredentialInfo, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	rows, err := s.DB.Query(
		ctx,
		`SELECT id, "credentialId", "friendlyName", "deviceType", "backedUp", "lastUsedAt", "createdAt"
		   FROM "WebAuthnCredential"
		  WHERE "userId" = $1
		  ORDER BY "createdAt" DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list webauthn credentials: %w", err)
	}
	defer rows.Close()

	result := make([]webauthnCredentialInfo, 0)
	for rows.Next() {
		var (
			item       webauthnCredentialInfo
			lastUsedAt *time.Time
			createdAt  time.Time
		)
		if err := rows.Scan(
			&item.ID,
			&item.CredentialID,
			&item.FriendlyName,
			&item.DeviceType,
			&item.BackedUp,
			&lastUsedAt,
			&createdAt,
		); err != nil {
			return nil, fmt.Errorf("scan webauthn credential: %w", err)
		}
		if lastUsedAt != nil {
			value := lastUsedAt.UTC().Format(time.RFC3339Nano)
			item.LastUsedAt = &value
		}
		item.CreatedAt = createdAt.UTC().Format(time.RFC3339Nano)
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate webauthn credentials: %w", err)
	}
	return result, nil
}

func maskPhone(phone string) string {
	if len(phone) <= 4 {
		return phone
	}
	return "+" + strings.Repeat("*", len(phone)-5) + phone[len(phone)-4:]
}
