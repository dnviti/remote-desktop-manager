package accesspolicies

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"sort"
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

type policyResponse struct {
	ID                   string    `json:"id"`
	TargetType           string    `json:"targetType"`
	TargetID             string    `json:"targetId"`
	AllowedTimeWindows   *string   `json:"allowedTimeWindows"`
	RequireTrustedDevice bool      `json:"requireTrustedDevice"`
	RequireMFAStepUp     bool      `json:"requireMfaStepUp"`
	CreatedAt            time.Time `json:"createdAt"`
	UpdatedAt            time.Time `json:"updatedAt"`
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	items, err := s.ListPolicies(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload struct {
		TargetType           string  `json:"targetType"`
		TargetID             string  `json:"targetId"`
		AllowedTimeWindows   *string `json:"allowedTimeWindows"`
		RequireTrustedDevice *bool   `json:"requireTrustedDevice"`
		RequireMFAStepUp     *bool   `json:"requireMfaStepUp"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.CreatePolicy(r.Context(), claims.TenantID, payload.TargetType, payload.TargetID, payload.AllowedTimeWindows, payload.RequireTrustedDevice, payload.RequireMFAStepUp)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload struct {
		AllowedTimeWindows   *string `json:"allowedTimeWindows"`
		RequireTrustedDevice *bool   `json:"requireTrustedDevice"`
		RequireMFAStepUp     *bool   `json:"requireMfaStepUp"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdatePolicy(r.Context(), claims.TenantID, r.PathValue("id"), payload.AllowedTimeWindows, payload.RequireTrustedDevice, payload.RequireMFAStepUp)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	if err := s.DeletePolicy(r.Context(), claims.TenantID, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) ListPolicies(ctx context.Context, tenantID string) ([]policyResponse, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}

	teamIDs, err := s.listTeamIDs(ctx, tenantID)
	if err != nil {
		return nil, err
	}
	folderIDs, err := s.listFolderIDs(ctx, teamIDs)
	if err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, "targetType"::text, "targetId", "allowedTimeWindows", "requireTrustedDevice", "requireMfaStepUp", "createdAt", "updatedAt"
FROM "AccessPolicy"
`)
	if err != nil {
		return nil, fmt.Errorf("list access policies: %w", err)
	}
	defer rows.Close()

	items := make([]policyResponse, 0)
	for rows.Next() {
		var (
			item               policyResponse
			allowedTimeWindows *string
		)
		if err := rows.Scan(
			&item.ID,
			&item.TargetType,
			&item.TargetID,
			&allowedTimeWindows,
			&item.RequireTrustedDevice,
			&item.RequireMFAStepUp,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan access policy: %w", err)
		}
		if !policyBelongsToTenant(item.TargetType, item.TargetID, tenantID, teamIDs, folderIDs) {
			continue
		}
		item.AllowedTimeWindows = allowedTimeWindows
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate access policies: %w", err)
	}

	sort.Slice(items, func(i, j int) bool { return items[i].CreatedAt.After(items[j].CreatedAt) })
	return items, nil
}

func (s Service) CreatePolicy(ctx context.Context, tenantID, targetType, targetID string, allowedTimeWindows *string, requireTrustedDevice, requireMFAStepUp *bool) (policyResponse, error) {
	if s.DB == nil {
		return policyResponse{}, errors.New("database is unavailable")
	}
	targetType = strings.ToUpper(strings.TrimSpace(targetType))
	if err := validateTargetType(targetType); err != nil {
		return policyResponse{}, err
	}
	if err := validateTimeWindows(allowedTimeWindows); err != nil {
		return policyResponse{}, err
	}
	if err := s.validateTarget(ctx, tenantID, targetType, targetID); err != nil {
		return policyResponse{}, err
	}

	var existingID string
	err := s.DB.QueryRow(ctx, `
SELECT id FROM "AccessPolicy"
WHERE "targetType" = $1::"AccessPolicyTargetType" AND "targetId" = $2
`, targetType, targetID).Scan(&existingID)
	if err == nil {
		return policyResponse{}, &requestError{status: http.StatusConflict, message: "A policy already exists for this target. Edit the existing policy instead."}
	}
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return policyResponse{}, fmt.Errorf("check duplicate access policy: %w", err)
	}

	var result policyResponse
	var allowed *string
	policyID := uuid.NewString()
	now := time.Now().UTC()
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "AccessPolicy" (id, "targetType", "targetId", "allowedTimeWindows", "requireTrustedDevice", "requireMfaStepUp", "createdAt", "updatedAt")
VALUES ($1, $2::"AccessPolicyTargetType", $3, $4, $5, $6, $7, $8)
RETURNING id, "targetType"::text, "targetId", "allowedTimeWindows", "requireTrustedDevice", "requireMfaStepUp", "createdAt", "updatedAt"
`, policyID, targetType, targetID, normalizeOptionalString(allowedTimeWindows), defaultBool(requireTrustedDevice), defaultBool(requireMFAStepUp), now, now).Scan(
		&result.ID,
		&result.TargetType,
		&result.TargetID,
		&allowed,
		&result.RequireTrustedDevice,
		&result.RequireMFAStepUp,
		&result.CreatedAt,
		&result.UpdatedAt,
	); err != nil {
		return policyResponse{}, fmt.Errorf("create access policy: %w", err)
	}
	result.AllowedTimeWindows = allowed
	return result, nil
}

func (s Service) UpdatePolicy(ctx context.Context, tenantID, policyID string, allowedTimeWindows *string, requireTrustedDevice, requireMFAStepUp *bool) (policyResponse, error) {
	if s.DB == nil {
		return policyResponse{}, errors.New("database is unavailable")
	}
	if err := validateTimeWindows(allowedTimeWindows); err != nil {
		return policyResponse{}, err
	}

	var (
		targetType string
		targetID   string
	)
	if err := s.DB.QueryRow(ctx, `SELECT "targetType"::text, "targetId" FROM "AccessPolicy" WHERE id = $1`, policyID).Scan(&targetType, &targetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return policyResponse{}, &requestError{status: http.StatusNotFound, message: "Policy not found"}
		}
		return policyResponse{}, fmt.Errorf("load access policy: %w", err)
	}
	if err := s.validateTarget(ctx, tenantID, targetType, targetID); err != nil {
		return policyResponse{}, err
	}

	setClauses := []string{}
	args := []any{policyID}
	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}
	if allowedTimeWindows != nil {
		add(`"allowedTimeWindows" = $%d`, normalizeOptionalString(allowedTimeWindows))
	}
	if requireTrustedDevice != nil {
		add(`"requireTrustedDevice" = $%d`, *requireTrustedDevice)
	}
	if requireMFAStepUp != nil {
		add(`"requireMfaStepUp" = $%d`, *requireMFAStepUp)
	}
	if len(setClauses) == 0 {
		return policyResponse{}, &requestError{status: http.StatusBadRequest, message: "No fields to update"}
	}
	setClauses = append(setClauses, `"updatedAt" = NOW()`)

	var result policyResponse
	var allowed *string
	query := fmt.Sprintf(`
UPDATE "AccessPolicy"
SET %s
WHERE id = $1
RETURNING id, "targetType"::text, "targetId", "allowedTimeWindows", "requireTrustedDevice", "requireMfaStepUp", "createdAt", "updatedAt"
`, strings.Join(setClauses, ", "))
	if err := s.DB.QueryRow(ctx, query, args...).Scan(
		&result.ID,
		&result.TargetType,
		&result.TargetID,
		&allowed,
		&result.RequireTrustedDevice,
		&result.RequireMFAStepUp,
		&result.CreatedAt,
		&result.UpdatedAt,
	); err != nil {
		return policyResponse{}, fmt.Errorf("update access policy: %w", err)
	}
	result.AllowedTimeWindows = allowed
	return result, nil
}

func (s Service) DeletePolicy(ctx context.Context, tenantID, policyID string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}

	var (
		targetType string
		targetID   string
	)
	if err := s.DB.QueryRow(ctx, `SELECT "targetType"::text, "targetId" FROM "AccessPolicy" WHERE id = $1`, policyID).Scan(&targetType, &targetID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusNotFound, message: "Policy not found"}
		}
		return fmt.Errorf("load access policy: %w", err)
	}
	if err := s.validateTarget(ctx, tenantID, targetType, targetID); err != nil {
		return err
	}
	if _, err := s.DB.Exec(ctx, `DELETE FROM "AccessPolicy" WHERE id = $1`, policyID); err != nil {
		return fmt.Errorf("delete access policy: %w", err)
	}
	return nil
}

func (s Service) validateTarget(ctx context.Context, tenantID, targetType, targetID string) error {
	switch targetType {
	case "TENANT":
		if targetID != tenantID {
			return &requestError{status: http.StatusForbidden, message: "Target tenant does not match your tenant"}
		}
		return nil
	case "TEAM":
		var foundTenantID string
		if err := s.DB.QueryRow(ctx, `SELECT "tenantId" FROM "Team" WHERE id = $1`, targetID).Scan(&foundTenantID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return &requestError{status: http.StatusNotFound, message: "Team not found or does not belong to your tenant"}
			}
			return fmt.Errorf("load team target: %w", err)
		}
		if foundTenantID != tenantID {
			return &requestError{status: http.StatusNotFound, message: "Team not found or does not belong to your tenant"}
		}
		return nil
	case "FOLDER":
		var foundTenantID string
		if err := s.DB.QueryRow(ctx, `
SELECT t."tenantId"
FROM "Folder" f
LEFT JOIN "Team" t ON t.id = f."teamId"
WHERE f.id = $1
`, targetID).Scan(&foundTenantID); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return &requestError{status: http.StatusNotFound, message: "Folder not found or does not belong to your tenant"}
			}
			return fmt.Errorf("load folder target: %w", err)
		}
		if foundTenantID != tenantID {
			return &requestError{status: http.StatusNotFound, message: "Folder not found or does not belong to your tenant"}
		}
		return nil
	default:
		return &requestError{status: http.StatusBadRequest, message: "Invalid target type"}
	}
}

func (s Service) listTeamIDs(ctx context.Context, tenantID string) (map[string]struct{}, error) {
	rows, err := s.DB.Query(ctx, `SELECT id FROM "Team" WHERE "tenantId" = $1`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant teams: %w", err)
	}
	defer rows.Close()

	result := make(map[string]struct{})
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan team id: %w", err)
		}
		result[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant teams: %w", err)
	}
	return result, nil
}

func (s Service) listFolderIDs(ctx context.Context, teamIDs map[string]struct{}) (map[string]struct{}, error) {
	if len(teamIDs) == 0 {
		return map[string]struct{}{}, nil
	}
	values := make([]string, 0, len(teamIDs))
	for id := range teamIDs {
		values = append(values, id)
	}

	rows, err := s.DB.Query(ctx, `SELECT id FROM "Folder" WHERE "teamId" = ANY($1)`, values)
	if err != nil {
		return nil, fmt.Errorf("list team folders: %w", err)
	}
	defer rows.Close()

	result := make(map[string]struct{})
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan folder id: %w", err)
		}
		result[id] = struct{}{}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate team folders: %w", err)
	}
	return result, nil
}

func requireTenantAdmin(claims authn.Claims) *requestError {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "OWNER", "ADMIN":
		return nil
	default:
		return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
}

func validateTargetType(targetType string) error {
	switch targetType {
	case "TENANT", "TEAM", "FOLDER":
		return nil
	default:
		return &requestError{status: http.StatusBadRequest, message: "Invalid target type"}
	}
}

func validateTimeWindows(value *string) error {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	for _, segment := range strings.Split(trimmed, ",") {
		segment = strings.TrimSpace(segment)
		if len(segment) != len("00:00-00:00") {
			return &requestError{status: http.StatusBadRequest, message: `Each time window must be in "HH:MM-HH:MM" format (hours 0-23, minutes 0-59)`}
		}
		parts := strings.Split(segment, "-")
		if len(parts) != 2 || !isValidClock(parts[0]) || !isValidClock(parts[1]) {
			return &requestError{status: http.StatusBadRequest, message: `Each time window must be in "HH:MM-HH:MM" format (hours 0-23, minutes 0-59)`}
		}
	}
	return nil
}

func isValidClock(value string) bool {
	if len(value) != 5 || value[2] != ':' {
		return false
	}
	hour := parseTwoDigits(value[:2])
	minute := parseTwoDigits(value[3:])
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

func parseTwoDigits(value string) int {
	if len(value) != 2 || value[0] < '0' || value[0] > '9' || value[1] < '0' || value[1] > '9' {
		return -1
	}
	return int(value[0]-'0')*10 + int(value[1]-'0')
}

func defaultBool(value *bool) bool {
	return value != nil && *value
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func policyBelongsToTenant(targetType, targetID, tenantID string, teamIDs, folderIDs map[string]struct{}) bool {
	switch targetType {
	case "TENANT":
		return targetID == tenantID
	case "TEAM":
		_, ok := teamIDs[targetID]
		return ok
	case "FOLDER":
		_, ok := folderIDs[targetID]
		return ok
	default:
		return false
	}
}

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
