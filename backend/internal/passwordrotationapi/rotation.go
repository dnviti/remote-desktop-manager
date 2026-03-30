package passwordrotationapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) EnableRotation(ctx context.Context, userID, tenantID, secretID string, intervalDays int, ipAddress string) (map[string]any, error) {
	secret, err := s.requireManageAccess(ctx, userID, tenantID, secretID)
	if err != nil {
		return nil, err
	}
	if secret.Type != "LOGIN" {
		return nil, &requestError{status: 400, message: "Password rotation is only supported for LOGIN-type secrets"}
	}
	if intervalDays < 1 || intervalDays > 365 {
		return nil, &requestError{status: 400, message: "intervalDays must be between 1 and 365"}
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "VaultSecret"
SET "targetRotationEnabled" = true,
    "rotationIntervalDays" = $2,
    "updatedAt" = NOW()
WHERE id = $1
`, secret.ID, intervalDays); err != nil {
		return nil, fmt.Errorf("enable password rotation: %w", err)
	}

	if err := s.insertAuditLog(ctx, userID, secret.ID, map[string]any{
		"field":        "targetRotationEnabled",
		"value":        true,
		"intervalDays": intervalDays,
	}, ipAddress); err != nil {
		return nil, err
	}

	return map[string]any{
		"enabled":      true,
		"intervalDays": intervalDays,
	}, nil
}

func (s Service) DisableRotation(ctx context.Context, userID, tenantID, secretID string, ipAddress string) (map[string]any, error) {
	secret, err := s.requireManageAccess(ctx, userID, tenantID, secretID)
	if err != nil {
		return nil, err
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "VaultSecret"
SET "targetRotationEnabled" = false,
    "updatedAt" = NOW()
WHERE id = $1
`, secret.ID); err != nil {
		return nil, fmt.Errorf("disable password rotation: %w", err)
	}

	if err := s.insertAuditLog(ctx, userID, secret.ID, map[string]any{
		"field": "targetRotationEnabled",
		"value": false,
	}, ipAddress); err != nil {
		return nil, err
	}

	return map[string]any{"enabled": false}, nil
}

func (s Service) GetRotationStatus(ctx context.Context, userID, tenantID, secretID string) (rotationStatusResponse, error) {
	secret, err := s.requireViewAccess(ctx, userID, tenantID, secretID)
	if err != nil {
		return rotationStatusResponse{}, err
	}

	var nextRotationAt *time.Time
	if secret.TargetRotationEnabled && secret.LastRotatedAt != nil {
		value := secret.LastRotatedAt.Add(time.Duration(secret.RotationIntervalDays) * 24 * time.Hour)
		nextRotationAt = &value
	}

	return rotationStatusResponse{
		Enabled:        secret.TargetRotationEnabled,
		IntervalDays:   secret.RotationIntervalDays,
		LastRotatedAt:  secret.LastRotatedAt,
		NextRotationAt: nextRotationAt,
	}, nil
}

func (s Service) GetRotationHistory(ctx context.Context, userID, tenantID, secretID string, limit int) ([]rotationHistoryEntry, error) {
	if _, err := s.requireViewAccess(ctx, userID, tenantID, secretID); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 20
	}
	if limit > 100 {
		limit = 100
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, status::text, trigger::text, "targetOS"::text, "targetHost", "targetUser", "errorMessage", "durationMs", "createdAt"
FROM "PasswordRotationLog"
WHERE "secretId" = $1
ORDER BY "createdAt" DESC
LIMIT $2
`, secretID, limit)
	if err != nil {
		return nil, fmt.Errorf("list password rotation history: %w", err)
	}
	defer rows.Close()

	items := make([]rotationHistoryEntry, 0)
	for rows.Next() {
		var item rotationHistoryEntry
		if err := rows.Scan(
			&item.ID,
			&item.Status,
			&item.Trigger,
			&item.TargetOS,
			&item.TargetHost,
			&item.TargetUser,
			&item.ErrorMessage,
			&item.DurationMs,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan password rotation history: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate password rotation history: %w", err)
	}
	return items, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, secretID string, details map[string]any, ipAddress string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, 'SECRET_UPDATE'::"AuditAction", 'VaultSecret', $3, $4::jsonb, NULLIF($5, ''))
`, uuid.NewString(), userID, secretID, string(rawDetails), ipAddress); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func isNotFound(err error) bool {
	if err == nil {
		return false
	}
	var reqErr *requestError
	return errors.As(err, &reqErr) && reqErr.status == 404
}

func isRequestError(err error) (*requestError, bool) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return reqErr, true
	}
	return nil, false
}

func isNoRows(err error) bool {
	return errors.Is(err, pgx.ErrNoRows)
}
