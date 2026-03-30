package vaultfolders

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) ensureParentExists(ctx context.Context, userID string, scope folderScope, teamID, tenantID, parentID *string) error {
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		return nil
	}
	if _, err := uuid.Parse(strings.TrimSpace(*parentID)); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "invalid parentId"}
	}

	query := `
SELECT EXISTS(
  SELECT 1
  FROM "VaultFolder"
  WHERE id = $1
    AND scope = $2::"SecretScope"
    AND COALESCE("teamId", '') = COALESCE($3, '')
    AND COALESCE("tenantId", '') = COALESCE($4, '')
    AND "userId" = CASE WHEN $2::"SecretScope" = 'PERSONAL' THEN $5 ELSE "userId" END
)`
	var exists bool
	if err := s.DB.QueryRow(ctx, query, *parentID, string(scope), teamID, tenantID, userID).Scan(&exists); err != nil {
		return fmt.Errorf("check parent vault folder: %w", err)
	}
	if !exists {
		return &requestError{status: http.StatusNotFound, message: "Parent folder not found"}
	}
	return nil
}

func (s Service) assertCanManage(ctx context.Context, userID, tenantID string, folder folderRecord) error {
	switch folder.Scope {
	case scopePersonal:
		if folder.UserID != userID {
			return &requestError{status: http.StatusNotFound, message: "Folder not found"}
		}
		return nil
	case scopeTeam:
		if folder.TeamID == nil {
			return &requestError{status: http.StatusNotFound, message: "Folder not found"}
		}
		return s.requireTeamRole(ctx, userID, tenantID, *folder.TeamID, "TEAM_EDITOR")
	case scopeTenant:
		effectiveTenantID := tenantID
		if folder.TenantID != nil && strings.TrimSpace(*folder.TenantID) != "" {
			effectiveTenantID = *folder.TenantID
		}
		if strings.TrimSpace(effectiveTenantID) == "" {
			return &requestError{status: http.StatusBadRequest, message: "Tenant context required"}
		}
		return s.requireTenantAdmin(ctx, userID, effectiveTenantID)
	default:
		return &requestError{status: http.StatusNotFound, message: "Folder not found"}
	}
}

func (s Service) requireTeamRole(ctx context.Context, userID, tenantID, teamID, minRole string) error {
	var (
		role       string
		teamTenant string
	)
	if err := s.DB.QueryRow(ctx, `
SELECT tm.role::text, t."tenantId"
FROM "TeamMember" tm
JOIN "Team" t ON t.id = tm."teamId"
WHERE tm."teamId" = $1 AND tm."userId" = $2
`, teamID, userID).Scan(&role, &teamTenant); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusForbidden, message: "Insufficient team role to manage vault folders"}
		}
		return fmt.Errorf("load team membership: %w", err)
	}
	if strings.TrimSpace(tenantID) != "" && teamTenant != tenantID {
		return &requestError{status: http.StatusForbidden, message: "Insufficient team role to manage vault folders"}
	}
	if teamRoleOrder(role) < teamRoleOrder(minRole) {
		return &requestError{status: http.StatusForbidden, message: "Insufficient team role to manage vault folders"}
	}
	return nil
}

func (s Service) requireTenantAdmin(ctx context.Context, userID, tenantID string) error {
	var role string
	if err := s.DB.QueryRow(ctx, `
SELECT role::text
FROM "TenantMember"
WHERE "tenantId" = $1 AND "userId" = $2
`, tenantID, userID).Scan(&role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusForbidden, message: "Only admins and owners can manage tenant vault folders"}
		}
		return fmt.Errorf("load tenant membership: %w", err)
	}
	switch role {
	case "OWNER", "ADMIN":
		return nil
	default:
		return &requestError{status: http.StatusForbidden, message: "Only admins and owners can manage tenant vault folders"}
	}
}
