package folders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB *pgxpool.Pool
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type optionalString struct {
	Present bool
	Value   *string
}

func (o *optionalString) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type createPayload struct {
	Name     string  `json:"name"`
	ParentID *string `json:"parentId"`
	TeamID   *string `json:"teamId"`
}

type updatePayload struct {
	Name     optionalString `json:"name"`
	ParentID optionalString `json:"parentId"`
}

type folderResponse struct {
	ID        string     `json:"id"`
	Name      string     `json:"name"`
	ParentID  *string    `json:"parentId"`
	SortOrder int        `json:"sortOrder"`
	TeamID    *string    `json:"teamId,omitempty"`
	TeamName  *string    `json:"teamName,omitempty"`
	Scope     string     `json:"scope"`
	CreatedAt time.Time  `json:"createdAt"`
	UpdatedAt time.Time  `json:"updatedAt"`
}

type listResponse struct {
	Personal []folderResponse `json:"personal"`
	Team     []folderResponse `json:"team"`
}

type accessResult struct {
	Folder   folderResponse
	TeamRole *string
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ListFolders(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.CreateFolder(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateFolder(r.Context(), claims, r.PathValue("id"), payload, requestIP(r))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Folder not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.DeleteFolder(r.Context(), claims, r.PathValue("id"), requestIP(r)); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Folder not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) ListFolders(ctx context.Context, userID, tenantID string) (listResponse, error) {
	personalRows, err := s.DB.Query(ctx, `
SELECT id, name, "parentId", "sortOrder", "createdAt", "updatedAt"
FROM "Folder"
WHERE "userId" = $1 AND "teamId" IS NULL
ORDER BY "sortOrder" ASC, name ASC
`, userID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list personal folders: %w", err)
	}
	defer personalRows.Close()

	var personal []folderResponse
	for personalRows.Next() {
		var folder folderResponse
		var parentID sql.NullString
		if err := personalRows.Scan(&folder.ID, &folder.Name, &parentID, &folder.SortOrder, &folder.CreatedAt, &folder.UpdatedAt); err != nil {
			return listResponse{}, fmt.Errorf("scan personal folder: %w", err)
		}
		if parentID.Valid {
			folder.ParentID = &parentID.String
		}
		folder.Scope = "private"
		personal = append(personal, folder)
	}
	if err := personalRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate personal folders: %w", err)
	}

	teamRows, err := s.DB.Query(ctx, `
SELECT f.id, f.name, f."parentId", f."sortOrder", f."teamId", t.name, f."createdAt", f."updatedAt"
FROM "Folder" f
JOIN "TeamMember" tm ON tm."teamId" = f."teamId"
JOIN "Team" t ON t.id = f."teamId"
WHERE tm."userId" = $1
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($2 = '' OR t."tenantId" = $2)
ORDER BY f."sortOrder" ASC, f.name ASC
`, userID, tenantID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list team folders: %w", err)
	}
	defer teamRows.Close()

	var team []folderResponse
	for teamRows.Next() {
		var folder folderResponse
		var parentID, teamID, teamName sql.NullString
		if err := teamRows.Scan(&folder.ID, &folder.Name, &parentID, &folder.SortOrder, &teamID, &teamName, &folder.CreatedAt, &folder.UpdatedAt); err != nil {
			return listResponse{}, fmt.Errorf("scan team folder: %w", err)
		}
		if parentID.Valid {
			folder.ParentID = &parentID.String
		}
		if teamID.Valid {
			folder.TeamID = &teamID.String
		}
		if teamName.Valid {
			folder.TeamName = &teamName.String
		}
		folder.Scope = "team"
		team = append(team, folder)
	}
	if err := teamRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate team folders: %w", err)
	}

	return listResponse{Personal: personal, Team: team}, nil
}

func (s Service) CreateFolder(ctx context.Context, claims authn.Claims, payload createPayload, ip *string) (folderResponse, error) {
	name := strings.TrimSpace(payload.Name)
	if name == "" {
		return folderResponse{}, &requestError{status: http.StatusBadRequest, message: "name is required"}
	}

	var teamID any
	scope := "private"
	if payload.TeamID != nil && strings.TrimSpace(*payload.TeamID) != "" {
		normalized := strings.TrimSpace(*payload.TeamID)
		role, err := s.requireTeamRole(ctx, claims.UserID, claims.TenantID, normalized, true)
		if err != nil {
			return folderResponse{}, err
		}
		_ = role
		teamID = normalized
		scope = "team"
		if err := s.ensureParentExists(ctx, claims.UserID, normalized, payload.ParentID); err != nil {
			return folderResponse{}, err
		}
	} else if err := s.ensureParentExists(ctx, claims.UserID, "", payload.ParentID); err != nil {
		return folderResponse{}, err
	}

	now := time.Now()
	folderID := uuid.NewString()
	var folder folderResponse
	var parentID, createdTeamID sql.NullString
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "Folder" (id, name, "parentId", "userId", "teamId", "sortOrder", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5, 0, $6, $7)
RETURNING id, name, "parentId", "sortOrder", "teamId", "createdAt", "updatedAt"
`, folderID, name, nullableString(payload.ParentID), claims.UserID, teamID, now, now).Scan(
		&folder.ID,
		&folder.Name,
		&parentID,
		&folder.SortOrder,
		&createdTeamID,
		&folder.CreatedAt,
		&folder.UpdatedAt,
	); err != nil {
		return folderResponse{}, fmt.Errorf("create folder: %w", err)
	}
	if parentID.Valid {
		folder.ParentID = &parentID.String
	}
	if createdTeamID.Valid {
		folder.TeamID = &createdTeamID.String
	}
	folder.Scope = scope
	if folder.TeamID != nil {
		teamName, err := s.lookupTeamName(ctx, *folder.TeamID)
		if err == nil {
			folder.TeamName = teamName
		}
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "CREATE_FOLDER", folder.ID, map[string]any{
		"name":   folder.Name,
		"teamId": folder.TeamID,
	}, ip)
	return folder, nil
}

func (s Service) UpdateFolder(ctx context.Context, claims authn.Claims, folderID string, payload updatePayload, ip *string) (folderResponse, error) {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, folderID)
	if err != nil {
		return folderResponse{}, err
	}

	var updates []string
	var args []any
	addUpdate := func(column string, value any) {
		updates = append(updates, fmt.Sprintf(`%s = $%d`, column, len(args)+1))
		args = append(args, value)
	}

	if payload.Name.Present {
		if payload.Name.Value == nil || strings.TrimSpace(*payload.Name.Value) == "" {
			return folderResponse{}, &requestError{status: http.StatusBadRequest, message: "name is required"}
		}
		addUpdate(`name`, strings.TrimSpace(*payload.Name.Value))
	}
	if payload.ParentID.Present {
		if payload.ParentID.Value != nil && strings.TrimSpace(*payload.ParentID.Value) == folderID {
			return folderResponse{}, &requestError{status: http.StatusBadRequest, message: "A folder cannot be its own parent"}
		}
		parentID := payload.ParentID.Value
		teamID := ""
		if access.Folder.TeamID != nil {
			teamID = *access.Folder.TeamID
		}
		if err := s.ensureParentExists(ctx, claims.UserID, teamID, parentID); err != nil {
			return folderResponse{}, err
		}
		addUpdate(`"parentId"`, nullableString(parentID))
	}

	if len(updates) == 0 {
		return access.Folder, nil
	}

	addUpdate(`"updatedAt"`, time.Now())
	args = append(args, folderID)
	query := fmt.Sprintf(`UPDATE "Folder" SET %s WHERE id = $%d`, strings.Join(updates, ", "), len(args))
	if _, err := s.DB.Exec(ctx, query, args...); err != nil {
		return folderResponse{}, fmt.Errorf("update folder: %w", err)
	}

	updated, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, folderID)
	if err != nil {
		return folderResponse{}, err
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "UPDATE_FOLDER", folderID, map[string]any{
		"fields": presentFields(payload),
	}, ip)
	return updated.Folder, nil
}

func (s Service) DeleteFolder(ctx context.Context, claims authn.Claims, folderID string, ip *string) error {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, folderID)
	if err != nil {
		return err
	}

	if access.Folder.TeamID != nil {
		if _, err := s.DB.Exec(ctx, `UPDATE "Connection" SET "folderId" = NULL WHERE "folderId" = $1 AND "teamId" = $2`, folderID, *access.Folder.TeamID); err != nil {
			return fmt.Errorf("detach team folder connections: %w", err)
		}
		if _, err := s.DB.Exec(ctx, `UPDATE "Folder" SET "parentId" = $1 WHERE "parentId" = $2 AND "teamId" = $3`, nullableString(access.Folder.ParentID), folderID, *access.Folder.TeamID); err != nil {
			return fmt.Errorf("reparent team child folders: %w", err)
		}
	} else {
		if _, err := s.DB.Exec(ctx, `UPDATE "Connection" SET "folderId" = NULL WHERE "folderId" = $1 AND "userId" = $2`, folderID, claims.UserID); err != nil {
			return fmt.Errorf("detach personal folder connections: %w", err)
		}
		if _, err := s.DB.Exec(ctx, `UPDATE "Folder" SET "parentId" = $1 WHERE "parentId" = $2 AND "userId" = $3 AND "teamId" IS NULL`, nullableString(access.Folder.ParentID), folderID, claims.UserID); err != nil {
			return fmt.Errorf("reparent personal child folders: %w", err)
		}
	}

	command, err := s.DB.Exec(ctx, `DELETE FROM "Folder" WHERE id = $1`, folderID)
	if err != nil {
		return fmt.Errorf("delete folder: %w", err)
	}
	if command.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DELETE_FOLDER", folderID, nil, ip)
	return nil
}

func (s Service) resolveAccess(ctx context.Context, userID, tenantID, folderID string) (accessResult, error) {
	if folder, err := s.loadPersonalFolder(ctx, folderID, userID); err == nil {
		return accessResult{Folder: folder}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return accessResult{}, err
	}

	folder, role, err := s.loadTeamFolder(ctx, folderID, userID, tenantID)
	if err != nil {
		return accessResult{}, err
	}
	if !canManageTeam(role) {
		return accessResult{}, pgx.ErrNoRows
	}
	return accessResult{Folder: folder, TeamRole: &role}, nil
}

func (s Service) loadPersonalFolder(ctx context.Context, folderID, userID string) (folderResponse, error) {
	var folder folderResponse
	var parentID sql.NullString
	if err := s.DB.QueryRow(ctx, `
SELECT id, name, "parentId", "sortOrder", "createdAt", "updatedAt"
FROM "Folder"
WHERE id = $1 AND "userId" = $2 AND "teamId" IS NULL
`, folderID, userID).Scan(&folder.ID, &folder.Name, &parentID, &folder.SortOrder, &folder.CreatedAt, &folder.UpdatedAt); err != nil {
		return folderResponse{}, err
	}
	if parentID.Valid {
		folder.ParentID = &parentID.String
	}
	folder.Scope = "private"
	return folder, nil
}

func (s Service) loadTeamFolder(ctx context.Context, folderID, userID, tenantID string) (folderResponse, string, error) {
	var folder folderResponse
	var parentID, teamID, teamName sql.NullString
	var role string
	err := s.DB.QueryRow(ctx, `
SELECT f.id, f.name, f."parentId", f."sortOrder", f."teamId", t.name, f."createdAt", f."updatedAt", tm.role::text
FROM "Folder" f
JOIN "Team" t ON t.id = f."teamId"
JOIN "TeamMember" tm ON tm."teamId" = f."teamId"
WHERE f.id = $1
  AND tm."userId" = $2
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($3 = '' OR t."tenantId" = $3)
`, folderID, userID, tenantID).Scan(
		&folder.ID,
		&folder.Name,
		&parentID,
		&folder.SortOrder,
		&teamID,
		&teamName,
		&folder.CreatedAt,
		&folder.UpdatedAt,
		&role,
	)
	if err != nil {
		return folderResponse{}, "", err
	}
	if parentID.Valid {
		folder.ParentID = &parentID.String
	}
	if teamID.Valid {
		folder.TeamID = &teamID.String
	}
	if teamName.Valid {
		folder.TeamName = &teamName.String
	}
	folder.Scope = "team"
	return folder, role, nil
}

func (s Service) ensureParentExists(ctx context.Context, userID, teamID string, parentID *string) error {
	if parentID == nil || strings.TrimSpace(*parentID) == "" {
		return nil
	}
	query := `SELECT 1 FROM "Folder" WHERE id = $1 AND "userId" = $2 AND "teamId" IS NULL`
	args := []any{strings.TrimSpace(*parentID), userID}
	if teamID != "" {
		query = `SELECT 1 FROM "Folder" WHERE id = $1 AND "teamId" = $2`
		args = []any{strings.TrimSpace(*parentID), teamID}
	}
	var ok int
	if err := s.DB.QueryRow(ctx, query, args...).Scan(&ok); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusNotFound, message: "Parent folder not found"}
		}
		return fmt.Errorf("check parent folder: %w", err)
	}
	return nil
}

func (s Service) requireTeamRole(ctx context.Context, userID, tenantID, teamID string, manage bool) (string, error) {
	var role string
	err := s.DB.QueryRow(ctx, `
SELECT tm.role::text
FROM "TeamMember" tm
JOIN "Team" t ON t.id = tm."teamId"
WHERE tm."teamId" = $1
  AND tm."userId" = $2
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($3 = '' OR t."tenantId" = $3)
`, teamID, userID, tenantID).Scan(&role)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			if manage {
				return "", &requestError{status: http.StatusForbidden, message: "Insufficient team role to create folders"}
			}
			return "", pgx.ErrNoRows
		}
		return "", fmt.Errorf("load team role: %w", err)
	}
	if manage && !canManageTeam(role) {
		return "", &requestError{status: http.StatusForbidden, message: "Insufficient team role to create folders"}
	}
	return role, nil
}

func canManageTeam(role string) bool {
	switch role {
	case "TEAM_ADMIN", "TEAM_EDITOR":
		return true
	default:
		return false
	}
}

func presentFields(payload updatePayload) []string {
	fields := make([]string, 0, 2)
	if payload.Name.Present {
		fields = append(fields, "name")
	}
	if payload.ParentID.Present {
		fields = append(fields, "parentId")
	}
	return fields
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func (s Service) lookupTeamName(ctx context.Context, teamID string) (*string, error) {
	var name string
	if err := s.DB.QueryRow(ctx, `SELECT name FROM "Team" WHERE id = $1`, teamID).Scan(&name); err != nil {
		return nil, err
	}
	return &name, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any, ip *string) error {
	var payload any
	if details != nil {
		payload = details
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", 'Folder', $4, $5, $6)
`, uuid.NewString(), userID, action, targetID, payload, ip)
	return err
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			host := stripPort(value)
			if host != "" {
				return &host
			}
		}
	}
	host := stripPort(r.RemoteAddr)
	if host == "" {
		return nil
	}
	return &host
}

func stripPort(value string) string {
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return strings.TrimSpace(value)
}
