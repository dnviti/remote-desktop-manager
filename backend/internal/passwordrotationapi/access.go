package passwordrotationapi

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s Service) requireViewAccess(ctx context.Context, userID, tenantID, secretID string) (secretRecord, error) {
	return s.requireAccess(ctx, userID, tenantID, secretID, false)
}

func (s Service) requireManageAccess(ctx context.Context, userID, tenantID, secretID string) (secretRecord, error) {
	return s.requireAccess(ctx, userID, tenantID, secretID, true)
}

func (s Service) requireAccess(ctx context.Context, userID, tenantID, secretID string, manage bool) (secretRecord, error) {
	if s.DB == nil {
		return secretRecord{}, errors.New("database is unavailable")
	}

	secret, err := s.loadSecret(ctx, secretID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return secretRecord{}, &requestError{status: 404, message: "Secret not found"}
		}
		return secretRecord{}, err
	}

	switch secret.Scope {
	case "PERSONAL":
		if secret.UserID == userID {
			return secret, nil
		}
	case "TEAM":
		if secret.TeamID == nil || secret.TeamTenantID == nil || tenantID == "" || *secret.TeamTenantID != tenantID {
			break
		}
		role, err := s.loadTeamRole(ctx, *secret.TeamID, userID)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				break
			}
			return secretRecord{}, err
		}
		if !manage || role == "TEAM_ADMIN" || role == "TEAM_EDITOR" {
			return secret, nil
		}
	case "TENANT":
		if secret.TenantID == nil || tenantID == "" || *secret.TenantID != tenantID {
			break
		}
		if manage {
			ok, err := s.hasTenantManageAccess(ctx, *secret.TenantID, userID)
			if err != nil {
				return secretRecord{}, err
			}
			if ok {
				return secret, nil
			}
			break
		}
		ok, err := s.hasTenantViewAccess(ctx, *secret.TenantID, userID)
		if err != nil {
			return secretRecord{}, err
		}
		if ok {
			return secret, nil
		}
	}

	return secretRecord{}, &requestError{status: 404, message: "Secret not found"}
}

func (s Service) loadSecret(ctx context.Context, secretID string) (secretRecord, error) {
	var record secretRecord
	err := s.DB.QueryRow(ctx, `
SELECT
  s.id,
  s.type::text,
  s.scope::text,
  s."userId",
  s."teamId",
  s."tenantId",
  t."tenantId",
  COALESCE(s."targetRotationEnabled", false),
  COALESCE(s."rotationIntervalDays", 30),
  s."lastRotatedAt"
FROM "VaultSecret" s
LEFT JOIN "Team" t ON t.id = s."teamId"
WHERE s.id = $1
`, secretID).Scan(
		&record.ID,
		&record.Type,
		&record.Scope,
		&record.UserID,
		&record.TeamID,
		&record.TenantID,
		&record.TeamTenantID,
		&record.TargetRotationEnabled,
		&record.RotationIntervalDays,
		&record.LastRotatedAt,
	)
	if err != nil {
		return secretRecord{}, fmt.Errorf("load vault secret: %w", err)
	}
	return record, nil
}

func (s Service) loadTeamRole(ctx context.Context, teamID, userID string) (string, error) {
	var role string
	err := s.DB.QueryRow(ctx, `
SELECT role::text
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, userID).Scan(&role)
	if err != nil {
		return "", fmt.Errorf("load team membership: %w", err)
	}
	return role, nil
}

func (s Service) hasTenantManageAccess(ctx context.Context, tenantID, userID string) (bool, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "TenantMember"
WHERE "tenantId" = $1
  AND "userId" = $2
  AND status = 'ACCEPTED'
  AND role IN ('OWNER', 'ADMIN')
`, tenantID, userID).Scan(&count); err != nil {
		return false, fmt.Errorf("check tenant manage access: %w", err)
	}
	return count > 0, nil
}

func (s Service) hasTenantViewAccess(ctx context.Context, tenantID, userID string) (bool, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "TenantVaultMember"
WHERE "tenantId" = $1 AND "userId" = $2
`, tenantID, userID).Scan(&count); err != nil {
		return false, fmt.Errorf("check tenant vault access: %w", err)
	}
	return count > 0, nil
}
