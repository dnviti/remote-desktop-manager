package auditapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5"
)

func (s Service) requireTenantAuditAccess(ctx context.Context, claims authn.Claims) *requestError {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "Tenant context is required"}
	}
	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return &requestError{status: http.StatusServiceUnavailable, message: err.Error()}
	}
	if membership == nil || !membership.Permissions[tenantauth.CanViewAuditLog] {
		return &requestError{status: http.StatusForbidden, message: "Forbidden"}
	}
	return nil
}

func (s Service) listCountriesByQuery(ctx context.Context, query, subject string) ([]string, error) {
	rows, err := s.DB.Query(ctx, query, subject)
	if err != nil {
		return nil, fmt.Errorf("list audit countries: %w", err)
	}
	defer rows.Close()
	items := make([]string, 0)
	for rows.Next() {
		var country string
		if err := rows.Scan(&country); err != nil {
			return nil, fmt.Errorf("scan audit country: %w", err)
		}
		items = append(items, country)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit countries: %w", err)
	}
	return items, nil
}

func (s Service) canViewConnection(ctx context.Context, claims authn.Claims, connectionID string) (bool, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
  c."userId",
  c."teamId",
  t."tenantId"
FROM "Connection" c
LEFT JOIN "Team" t ON t.id = c."teamId"
WHERE c.id = $1
`, connectionID)

	var (
		ownerID  string
		teamID   *string
		tenantID *string
	)
	if err := row.Scan(&ownerID, &teamID, &tenantID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("load connection access: %w", err)
	}

	if tenantID != nil && strings.TrimSpace(claims.TenantID) != "" && *tenantID != claims.TenantID {
		return false, nil
	}
	if ownerID == claims.UserID && teamID == nil {
		return true, nil
	}
	if teamID != nil {
		var exists bool
		if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1
  FROM "TeamMember"
  WHERE "teamId" = $1
    AND "userId" = $2
)
`, *teamID, claims.UserID).Scan(&exists); err != nil {
			return false, fmt.Errorf("check team connection access: %w", err)
		}
		if exists {
			return true, nil
		}
	}
	var shared bool
	if err := s.DB.QueryRow(ctx, `
SELECT EXISTS(
  SELECT 1
  FROM "SharedConnection"
  WHERE "connectionId" = $1
    AND "sharedWithUserId" = $2
)
`, connectionID, claims.UserID).Scan(&shared); err != nil {
		return false, fmt.Errorf("check shared connection access: %w", err)
	}
	return shared, nil
}

func isAuditAdmin(role string) bool {
	switch role {
	case "OWNER", "ADMIN", "AUDITOR":
		return true
	default:
		return false
	}
}
