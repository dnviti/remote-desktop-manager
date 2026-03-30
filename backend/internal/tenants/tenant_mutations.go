package tenants

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s Service) UpdateTenant(ctx context.Context, tenantID string, payload map[string]json.RawMessage) (tenantResponse, error) {
	if len(payload) == 0 {
		return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: "No fields to update"}
	}

	setClauses := []string{`"updatedAt" = NOW()`}
	args := []any{tenantID}

	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}

	for key, raw := range payload {
		raw = json.RawMessage(bytesTrimSpace(raw))
		switch key {
		case "name":
			var value string
			if err := json.Unmarshal(raw, &value); err != nil {
				return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: "name must be a string"}
			}
			value = strings.TrimSpace(value)
			if len(value) < 2 || len(value) > 100 {
				return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: "name must be between 2 and 100 characters"}
			}
			slug, err := s.ensureUniqueSlug(ctx, generateSlug(value), tenantID)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"name" = $%d`, value)
			add(`slug = $%d`, slug)
		case "defaultSessionTimeoutSeconds":
			value, err := parseRequiredInt(raw, 60, 86400, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"defaultSessionTimeoutSeconds" = $%d`, value)
		case "maxConcurrentSessions":
			value, err := parseRequiredInt(raw, 0, 100, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"maxConcurrentSessions" = $%d`, value)
		case "absoluteSessionTimeoutSeconds":
			value, err := parseRequiredInt(raw, 0, 604800, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"absoluteSessionTimeoutSeconds" = $%d`, value)
		case "mfaRequired":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"mfaRequired" = $%d`, value)
		case "vaultAutoLockMaxMinutes":
			value, err := parseNullableInt(raw, 0, 1_000_000, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"vaultAutoLockMaxMinutes" = $%d`, value)
		case "dlpDisableCopy":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"dlpDisableCopy" = $%d`, value)
		case "dlpDisablePaste":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"dlpDisablePaste" = $%d`, value)
		case "dlpDisableDownload":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"dlpDisableDownload" = $%d`, value)
		case "dlpDisableUpload":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"dlpDisableUpload" = $%d`, value)
		case "enforcedConnectionSettings":
			add(`"enforcedConnectionSettings" = $%d::jsonb`, string(raw))
		case "tunnelDefaultEnabled":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"tunnelDefaultEnabled" = $%d`, value)
		case "tunnelAutoTokenRotation":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"tunnelAutoTokenRotation" = $%d`, value)
		case "tunnelTokenRotationDays":
			value, err := parseRequiredInt(raw, 1, 365, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"tunnelTokenRotationDays" = $%d`, value)
		case "tunnelRequireForRemote":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"tunnelRequireForRemote" = $%d`, value)
		case "tunnelTokenMaxLifetimeDays":
			value, err := parseNullableInt(raw, 1, 365, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"tunnelTokenMaxLifetimeDays" = $%d`, value)
		case "tunnelAgentAllowedCidrs":
			var values []string
			if err := json.Unmarshal(raw, &values); err != nil {
				return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: "tunnelAgentAllowedCidrs must be an array of strings"}
			}
			add(`"tunnelAgentAllowedCidrs" = $%d`, values)
		case "loginRateLimitWindowMs":
			value, err := parseNullableInt(raw, 1000, 86400000, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"loginRateLimitWindowMs" = $%d`, value)
		case "loginRateLimitMaxAttempts":
			value, err := parseNullableInt(raw, 1, 100, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"loginRateLimitMaxAttempts" = $%d`, value)
		case "accountLockoutThreshold":
			value, err := parseNullableInt(raw, 1, 100, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"accountLockoutThreshold" = $%d`, value)
		case "accountLockoutDurationMs":
			value, err := parseNullableInt(raw, 60000, 86400000, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"accountLockoutDurationMs" = $%d`, value)
		case "impossibleTravelSpeedKmh":
			value, err := parseNullableInt(raw, 0, 50000, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"impossibleTravelSpeedKmh" = $%d`, value)
		case "jwtExpiresInSeconds":
			value, err := parseNullableInt(raw, 60, 86400, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"jwtExpiresInSeconds" = $%d`, value)
		case "jwtRefreshExpiresInSeconds":
			value, err := parseNullableInt(raw, 300, 2592000, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"jwtRefreshExpiresInSeconds" = $%d`, value)
		case "vaultDefaultTtlMinutes":
			value, err := parseNullableInt(raw, 0, 10080, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"vaultDefaultTtlMinutes" = $%d`, value)
		case "recordingEnabled":
			value, err := parseRequiredBool(raw, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"recordingEnabled" = $%d`, value)
		case "recordingRetentionDays":
			value, err := parseNullableInt(raw, 1, 3650, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"recordingRetentionDays" = $%d`, value)
		case "fileUploadMaxSizeBytes":
			value, err := parseNullableInt(raw, 1, 2147483647, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"fileUploadMaxSizeBytes" = $%d`, value)
		case "userDriveQuotaBytes":
			value, err := parseNullableInt(raw, 1, 2147483647, key)
			if err != nil {
				return tenantResponse{}, err
			}
			add(`"userDriveQuotaBytes" = $%d`, value)
		default:
			return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("unsupported field: %s", key)}
		}
	}

	if len(setClauses) == 1 {
		return tenantResponse{}, &requestError{status: http.StatusBadRequest, message: "No fields to update"}
	}

	query := fmt.Sprintf(`UPDATE "Tenant" SET %s WHERE id = $1 RETURNING id`, strings.Join(setClauses, ", "))
	var updatedID string
	if err := s.DB.QueryRow(ctx, query, args...).Scan(&updatedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantResponse{}, &requestError{status: http.StatusNotFound, message: "Organization not found"}
		}
		return tenantResponse{}, fmt.Errorf("update tenant: %w", err)
	}

	return s.GetTenant(ctx, updatedID)
}

func (s Service) DeleteTenant(ctx context.Context, tenantID string) (map[string]bool, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tenant delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
DELETE FROM "TeamMember"
WHERE "teamId" IN (SELECT id FROM "Team" WHERE "tenantId" = $1)
`, tenantID); err != nil {
		return nil, fmt.Errorf("delete team members: %w", err)
	}

	if _, err := tx.Exec(ctx, `
UPDATE "Connection"
SET "teamId" = NULL
WHERE "teamId" IN (SELECT id FROM "Team" WHERE "tenantId" = $1)
`, tenantID); err != nil {
		return nil, fmt.Errorf("clear team connections: %w", err)
	}

	if _, err := tx.Exec(ctx, `
UPDATE "Folder"
SET "teamId" = NULL
WHERE "teamId" IN (SELECT id FROM "Team" WHERE "tenantId" = $1)
`, tenantID); err != nil {
		return nil, fmt.Errorf("clear team folders: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "Team" WHERE "tenantId" = $1`, tenantID); err != nil {
		return nil, fmt.Errorf("delete teams: %w", err)
	}

	var deletedID string
	if err := tx.QueryRow(ctx, `DELETE FROM "Tenant" WHERE id = $1 RETURNING id`, tenantID).Scan(&deletedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{status: http.StatusNotFound, message: "Organization not found"}
		}
		return nil, fmt.Errorf("delete tenant: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tenant delete: %w", err)
	}
	return map[string]bool{"deleted": true}, nil
}
