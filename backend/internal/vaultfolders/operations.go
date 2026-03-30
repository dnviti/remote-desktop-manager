package vaultfolders

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) ListFolders(ctx context.Context, userID, tenantID string) (listResponse, error) {
	personalRows, err := s.DB.Query(ctx, `
SELECT id, name, "parentId", "userId", scope::text, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt"
FROM "VaultFolder"
WHERE "userId" = $1 AND scope = 'PERSONAL'
ORDER BY "sortOrder" ASC, name ASC
`, userID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list personal vault folders: %w", err)
	}
	defer personalRows.Close()

	personal := make([]folderRecord, 0)
	for personalRows.Next() {
		item, err := scanFolder(personalRows)
		if err != nil {
			return listResponse{}, err
		}
		personal = append(personal, item)
	}
	if err := personalRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate personal vault folders: %w", err)
	}

	teamRows, err := s.DB.Query(ctx, `
SELECT vf.id, vf.name, vf."parentId", vf."userId", vf.scope::text, vf."teamId", vf."tenantId", vf."sortOrder", vf."createdAt", vf."updatedAt", t.name
FROM "VaultFolder" vf
JOIN "TeamMember" tm ON tm."teamId" = vf."teamId"
JOIN "Team" t ON t.id = vf."teamId"
WHERE tm."userId" = $1
  AND vf.scope = 'TEAM'
  AND ($2 = '' OR t."tenantId" = $2)
ORDER BY vf."sortOrder" ASC, vf.name ASC
`, userID, tenantID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list team vault folders: %w", err)
	}
	defer teamRows.Close()

	team := make([]folderRecord, 0)
	for teamRows.Next() {
		item, err := scanFolderWithTeamName(teamRows)
		if err != nil {
			return listResponse{}, err
		}
		team = append(team, item)
	}
	if err := teamRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate team vault folders: %w", err)
	}

	tenant := make([]folderRecord, 0)
	if strings.TrimSpace(tenantID) != "" {
		tenantRows, err := s.DB.Query(ctx, `
SELECT id, name, "parentId", "userId", scope::text, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt"
FROM "VaultFolder"
WHERE "tenantId" = $1 AND scope = 'TENANT'
ORDER BY "sortOrder" ASC, name ASC
`, tenantID)
		if err != nil {
			return listResponse{}, fmt.Errorf("list tenant vault folders: %w", err)
		}
		defer tenantRows.Close()
		for tenantRows.Next() {
			item, err := scanFolder(tenantRows)
			if err != nil {
				return listResponse{}, err
			}
			tenant = append(tenant, item)
		}
		if err := tenantRows.Err(); err != nil {
			return listResponse{}, fmt.Errorf("iterate tenant vault folders: %w", err)
		}
	}

	return listResponse{Personal: personal, Team: team, Tenant: tenant}, nil
}

func (s Service) CreateFolder(ctx context.Context, claims authn.Claims, payload createPayload) (folderRecord, error) {
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "name is required"}
	}
	if payload.Scope != scopePersonal && payload.Scope != scopeTeam && payload.Scope != scopeTenant {
		return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "scope must be one of PERSONAL, TEAM, TENANT"}
	}

	parentID := normalizeOptionalStringPtrValue(payload.ParentID)
	teamID := normalizeOptionalStringPtrValue(payload.TeamID)
	tenantID := normalizeOptionalStringPtr(claims.TenantID)

	switch payload.Scope {
	case scopePersonal:
		teamID = nil
	case scopeTeam:
		if teamID == nil {
			return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "teamId is required for team-scoped folders"}
		}
		if err := s.requireTeamRole(ctx, claims.UserID, claims.TenantID, *teamID, "TEAM_EDITOR"); err != nil {
			return folderRecord{}, err
		}
	case scopeTenant:
		if tenantID == nil {
			return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "tenantId is required for tenant-scoped folders"}
		}
		if err := s.requireTenantAdmin(ctx, claims.UserID, *tenantID); err != nil {
			return folderRecord{}, err
		}
		teamID = nil
	default:
		return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "invalid scope"}
	}

	if err := s.ensureParentExists(ctx, claims.UserID, payload.Scope, teamID, tenantID, parentID); err != nil {
		return folderRecord{}, err
	}

	now := time.Now().UTC()
	folderID := uuid.NewString()
	row := s.DB.QueryRow(ctx, `
INSERT INTO "VaultFolder" (id, name, "parentId", "userId", scope, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5::"SecretScope", $6, $7, 0, $8, $9)
RETURNING id, name, "parentId", "userId", scope::text, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt"
		`, folderID, name, parentID, claims.UserID, string(payload.Scope), teamID, tenantID, now, now)

	item, err := scanFolder(row)
	if err != nil {
		return folderRecord{}, fmt.Errorf("create vault folder: %w", err)
	}
	if item.TeamID != nil {
		item.TeamName, _ = s.lookupTeamName(ctx, *item.TeamID)
	}
	if err := s.insertAuditLog(ctx, claims.UserID, "CREATE_FOLDER", item.ID, map[string]any{
		"name":   item.Name,
		"scope":  item.Scope,
		"teamId": item.TeamID,
	}); err != nil {
		return folderRecord{}, err
	}
	return item, nil
}

func (s Service) UpdateFolder(ctx context.Context, claims authn.Claims, folderID string, payload updatePayload) (folderRecord, error) {
	item, err := s.getFolder(ctx, folderID)
	if err != nil {
		return folderRecord{}, err
	}
	if err := s.assertCanManage(ctx, claims.UserID, claims.TenantID, item); err != nil {
		return folderRecord{}, err
	}

	newName := item.Name
	if payload.Name != nil {
		newName = strings.TrimSpace(*payload.Name)
	}
	if newName == "" {
		return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "name is required"}
	}

	newParentID := item.ParentID
	if payload.ParentID != nil {
		trimmed := strings.TrimSpace(*payload.ParentID)
		if trimmed == "" {
			newParentID = nil
		} else {
			if trimmed == item.ID {
				return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "A folder cannot be its own parent"}
			}
			newParentID = &trimmed
		}
	}

	if err := s.ensureParentExists(ctx, claims.UserID, item.Scope, item.TeamID, item.TenantID, newParentID); err != nil {
		return folderRecord{}, err
	}

	row := s.DB.QueryRow(ctx, `
UPDATE "VaultFolder"
SET name = $2,
    "parentId" = $3,
    "updatedAt" = NOW()
WHERE id = $1
RETURNING id, name, "parentId", "userId", scope::text, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt"
`, item.ID, newName, newParentID)

	updated, err := scanFolder(row)
	if err != nil {
		return folderRecord{}, fmt.Errorf("update vault folder: %w", err)
	}
	if updated.TeamID != nil {
		updated.TeamName, _ = s.lookupTeamName(ctx, *updated.TeamID)
	}
	if err := s.insertAuditLog(ctx, claims.UserID, "UPDATE_FOLDER", updated.ID, map[string]any{
		"fields": changedFields(item, updated),
	}); err != nil {
		return folderRecord{}, err
	}
	return updated, nil
}

func (s Service) DeleteFolder(ctx context.Context, claims authn.Claims, folderID string) error {
	item, err := s.getFolder(ctx, folderID)
	if err != nil {
		return err
	}
	if err := s.assertCanManage(ctx, claims.UserID, claims.TenantID, item); err != nil {
		return err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin vault folder delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `UPDATE "VaultSecret" SET "folderId" = $2 WHERE "folderId" = $1`, item.ID, item.ParentID); err != nil {
		return fmt.Errorf("move vault secrets: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "VaultFolder" SET "parentId" = $2, "updatedAt" = NOW() WHERE "parentId" = $1`, item.ID, item.ParentID); err != nil {
		return fmt.Errorf("move child vault folders: %w", err)
	}
	commandTag, err := tx.Exec(ctx, `DELETE FROM "VaultFolder" WHERE id = $1`, item.ID)
	if err != nil {
		return fmt.Errorf("delete vault folder: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if err := insertAuditLogTx(ctx, tx, claims.UserID, "DELETE_FOLDER", item.ID, nil); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit vault folder delete: %w", err)
	}
	return nil
}

func (s Service) getFolder(ctx context.Context, folderID string) (folderRecord, error) {
	if _, err := uuid.Parse(strings.TrimSpace(folderID)); err != nil {
		return folderRecord{}, &requestError{status: http.StatusBadRequest, message: "invalid folder id"}
	}
	row := s.DB.QueryRow(ctx, `
SELECT id, name, "parentId", "userId", scope::text, "teamId", "tenantId", "sortOrder", "createdAt", "updatedAt"
FROM "VaultFolder"
WHERE id = $1
`, folderID)
	item, err := scanFolder(row)
	if err != nil {
		if err == pgx.ErrNoRows {
			return folderRecord{}, &requestError{status: http.StatusNotFound, message: "Folder not found"}
		}
		return folderRecord{}, fmt.Errorf("load vault folder: %w", err)
	}
	return item, nil
}
