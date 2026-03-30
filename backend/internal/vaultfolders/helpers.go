package vaultfolders

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) lookupTeamName(ctx context.Context, teamID string) (*string, error) {
	var name string
	if err := s.DB.QueryRow(ctx, `SELECT name FROM "Team" WHERE id = $1`, teamID).Scan(&name); err != nil {
		return nil, err
	}
	return &name, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any) error {
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "createdAt")
VALUES ($1, $2, $3::"AuditAction", 'VaultFolder', $4, $5::jsonb, NOW())
`, uuid.NewString(), userID, action, targetID, marshalDetails(details))
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func insertAuditLogTx(ctx context.Context, tx pgx.Tx, userID, action, targetID string, details map[string]any) error {
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "createdAt")
VALUES ($1, $2, $3::"AuditAction", 'VaultFolder', $4, $5::jsonb, NOW())
`, uuid.NewString(), userID, action, targetID, marshalDetails(details)); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func marshalDetails(details map[string]any) string {
	if details == nil {
		return "null"
	}
	jsonValue, err := json.Marshal(details)
	if err != nil {
		return "null"
	}
	return string(jsonValue)
}

func ensureKeychainEnabled() *requestError {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("FEATURE_KEYCHAIN_ENABLED")), "false") {
		return &requestError{status: http.StatusForbidden, message: "The Keychain feature is currently disabled."}
	}
	return nil
}

func scanFolder(row interface{ Scan(...any) error }) (folderRecord, error) {
	var (
		item             folderRecord
		parentID, teamID sql.NullString
		tenantID         sql.NullString
		scope            string
	)
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&parentID,
		&item.UserID,
		&scope,
		&teamID,
		&tenantID,
		&item.SortOrder,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return folderRecord{}, err
	}
	if parentID.Valid {
		item.ParentID = &parentID.String
	}
	if teamID.Valid {
		item.TeamID = &teamID.String
	}
	if tenantID.Valid {
		item.TenantID = &tenantID.String
	}
	item.Scope = folderScope(scope)
	return item, nil
}

func scanFolderWithTeamName(row interface{ Scan(...any) error }) (folderRecord, error) {
	var (
		record             folderRecord
		parentID, teamID   sql.NullString
		tenantID, teamName sql.NullString
		scope              string
	)
	if err := row.Scan(
		&record.ID,
		&record.Name,
		&parentID,
		&record.UserID,
		&scope,
		&teamID,
		&tenantID,
		&record.SortOrder,
		&record.CreatedAt,
		&record.UpdatedAt,
		&teamName,
	); err != nil {
		return folderRecord{}, err
	}
	if parentID.Valid {
		record.ParentID = &parentID.String
	}
	if teamID.Valid {
		record.TeamID = &teamID.String
	}
	if tenantID.Valid {
		record.TenantID = &tenantID.String
	}
	if teamName.Valid {
		record.TeamName = &teamName.String
	}
	record.Scope = folderScope(scope)
	return record, nil
}

func normalizeOptionalStringPtrValue(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func normalizeOptionalStringPtr(value string) *string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func teamRoleOrder(role string) int {
	switch role {
	case "TEAM_ADMIN":
		return 2
	case "TEAM_EDITOR":
		return 1
	case "TEAM_VIEWER":
		return 0
	default:
		return -1
	}
}

func changedFields(before, after folderRecord) []string {
	fields := make([]string, 0, 2)
	if before.Name != after.Name {
		fields = append(fields, "name")
	}
	if derefString(before.ParentID) != derefString(after.ParentID) {
		fields = append(fields, "parentId")
	}
	sort.Strings(fields)
	return fields
}

func derefString(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	if errors.Is(err, pgx.ErrNoRows) {
		app.ErrorJSON(w, http.StatusNotFound, "Folder not found")
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
