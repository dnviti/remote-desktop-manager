package keystrokepolicies

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	maxPatternLength     = 500
	maxPatternsPerPolicy = 50
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

type policyResponse struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenantId"`
	Name          string    `json:"name"`
	Description   *string   `json:"description"`
	Action        string    `json:"action"`
	RegexPatterns []string  `json:"regexPatterns"`
	Enabled       bool      `json:"enabled"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type createPayload struct {
	Name          string   `json:"name"`
	Description   *string  `json:"description"`
	Action        string   `json:"action"`
	RegexPatterns []string `json:"regexPatterns"`
	Enabled       *bool    `json:"enabled"`
}

type updatePayload struct {
	Name          *string   `json:"name"`
	Description   **string  `json:"description"`
	Action        *string   `json:"action"`
	RegexPatterns *[]string `json:"regexPatterns"`
	Enabled       *bool     `json:"enabled"`
}

type rowScanner interface {
	Scan(dest ...any) error
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	items, err := s.List(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	item, err := s.Get(r.Context(), claims.TenantID, r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.Create(r.Context(), claims, payload)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, item)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.Update(r.Context(), claims, r.PathValue("id"), payload)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.Delete(r.Context(), claims, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) List(ctx context.Context, tenantID string) ([]policyResponse, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, description, action::text, "regexPatterns", enabled, "createdAt", "updatedAt"
FROM "KeystrokePolicy"
WHERE "tenantId" = $1
ORDER BY "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list keystroke policies: %w", err)
	}
	defer rows.Close()

	items := make([]policyResponse, 0)
	for rows.Next() {
		item, err := scanPolicy(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate keystroke policies: %w", err)
	}
	return items, nil
}

func (s Service) Get(ctx context.Context, tenantID, policyID string) (policyResponse, error) {
	if s.DB == nil {
		return policyResponse{}, errors.New("database is unavailable")
	}
	row := s.DB.QueryRow(ctx, `
SELECT id, "tenantId", name, description, action::text, "regexPatterns", enabled, "createdAt", "updatedAt"
FROM "KeystrokePolicy"
WHERE id = $1 AND "tenantId" = $2
`, policyID, tenantID)
	item, err := scanPolicy(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return policyResponse{}, &requestError{status: http.StatusNotFound, message: "Keystroke policy not found"}
		}
		return policyResponse{}, err
	}
	return item, nil
}

func (s Service) Create(ctx context.Context, claims authn.Claims, payload createPayload) (policyResponse, error) {
	if s.DB == nil {
		return policyResponse{}, errors.New("database is unavailable")
	}
	if err := validateName(payload.Name); err != nil {
		return policyResponse{}, err
	}
	action, err := normalizeAction(payload.Action)
	if err != nil {
		return policyResponse{}, err
	}
	patterns, err := validatePatterns(payload.RegexPatterns)
	if err != nil {
		return policyResponse{}, err
	}

	description := normalizeOptionalString(payload.Description)
	enabled := true
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	now := time.Now().UTC()
	item := policyResponse{}
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "KeystrokePolicy" (
	id, "tenantId", name, description, action, "regexPatterns", enabled, "createdAt", "updatedAt"
)
VALUES ($1, $2, $3, $4, $5::"KeystrokePolicyAction", $6, $7, $8, $9)
RETURNING id, "tenantId", name, description, action::text, "regexPatterns", enabled, "createdAt", "updatedAt"
`, uuid.NewString(), claims.TenantID, strings.TrimSpace(payload.Name), description, action, patterns, enabled, now, now).Scan(
		&item.ID,
		&item.TenantID,
		&item.Name,
		&item.Description,
		&item.Action,
		&item.RegexPatterns,
		&item.Enabled,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return policyResponse{}, fmt.Errorf("create keystroke policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "KEYSTROKE_POLICY_CREATE", item.ID, map[string]any{
		"name":         item.Name,
		"action":       item.Action,
		"patternCount": len(item.RegexPatterns),
	})
	return item, nil
}

func (s Service) Update(ctx context.Context, claims authn.Claims, policyID string, payload updatePayload) (policyResponse, error) {
	if s.DB == nil {
		return policyResponse{}, errors.New("database is unavailable")
	}
	if _, err := s.Get(ctx, claims.TenantID, policyID); err != nil {
		return policyResponse{}, err
	}

	setClauses := []string{}
	args := []any{policyID, claims.TenantID}
	add := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}

	if payload.Name != nil {
		if err := validateName(*payload.Name); err != nil {
			return policyResponse{}, err
		}
		add(`name = $%d`, strings.TrimSpace(*payload.Name))
	}
	if payload.Description != nil {
		add(`description = $%d`, normalizeOptionalString(*payload.Description))
	}
	if payload.Action != nil {
		action, err := normalizeAction(*payload.Action)
		if err != nil {
			return policyResponse{}, err
		}
		add(`action = $%d::"KeystrokePolicyAction"`, action)
	}
	if payload.RegexPatterns != nil {
		patterns, err := validatePatterns(*payload.RegexPatterns)
		if err != nil {
			return policyResponse{}, err
		}
		add(`"regexPatterns" = $%d`, patterns)
	}
	if payload.Enabled != nil {
		add(`enabled = $%d`, *payload.Enabled)
	}
	if len(setClauses) == 0 {
		return s.Get(ctx, claims.TenantID, policyID)
	}

	args = append(args, time.Now().UTC())
	setClauses = append(setClauses, fmt.Sprintf(`"updatedAt" = $%d`, len(args)))
	query := fmt.Sprintf(`
UPDATE "KeystrokePolicy"
SET %s
WHERE id = $1 AND "tenantId" = $2
RETURNING id, "tenantId", name, description, action::text, "regexPatterns", enabled, "createdAt", "updatedAt"
`, strings.Join(setClauses, ", "))

	item := policyResponse{}
	if err := s.DB.QueryRow(ctx, query, args...).Scan(
		&item.ID,
		&item.TenantID,
		&item.Name,
		&item.Description,
		&item.Action,
		&item.RegexPatterns,
		&item.Enabled,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return policyResponse{}, &requestError{status: http.StatusNotFound, message: "Keystroke policy not found"}
		}
		return policyResponse{}, fmt.Errorf("update keystroke policy: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "KEYSTROKE_POLICY_UPDATE", item.ID, map[string]any{
		"name":   item.Name,
		"action": item.Action,
	})
	return item, nil
}

func (s Service) Delete(ctx context.Context, claims authn.Claims, policyID string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	cmd, err := s.DB.Exec(ctx, `DELETE FROM "KeystrokePolicy" WHERE id = $1 AND "tenantId" = $2`, policyID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("delete keystroke policy: %w", err)
	}
	if cmd.RowsAffected() == 0 {
		return &requestError{status: http.StatusNotFound, message: "Keystroke policy not found"}
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "KEYSTROKE_POLICY_DELETE", policyID, nil)
	return nil
}

func scanPolicy(row rowScanner) (policyResponse, error) {
	var item policyResponse
	if err := row.Scan(
		&item.ID,
		&item.TenantID,
		&item.Name,
		&item.Description,
		&item.Action,
		&item.RegexPatterns,
		&item.Enabled,
		&item.CreatedAt,
		&item.UpdatedAt,
	); err != nil {
		return policyResponse{}, fmt.Errorf("scan keystroke policy: %w", err)
	}
	return item, nil
}

func requireTenantAdmin(claims authn.Claims) *requestError {
	if claims.TenantID == "" {
		return &requestError{status: http.StatusForbidden, message: "Tenant context is required"}
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "ADMIN", "OWNER":
		return nil
	default:
		return &requestError{status: http.StatusForbidden, message: "Admin role required"}
	}
}

func validateName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return &requestError{status: http.StatusBadRequest, message: "Name is required"}
	}
	if len(name) > 200 {
		return &requestError{status: http.StatusBadRequest, message: "Name must be 200 characters or fewer"}
	}
	return nil
}

func normalizeAction(action string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(action)) {
	case "BLOCK_AND_TERMINATE", "ALERT_ONLY":
		return strings.ToUpper(strings.TrimSpace(action)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid keystroke policy action"}
	}
}

func validatePatterns(patterns []string) ([]string, error) {
	if len(patterns) == 0 {
		return nil, &requestError{status: http.StatusBadRequest, message: "At least one regex pattern is required"}
	}
	if len(patterns) > maxPatternsPerPolicy {
		return nil, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Too many regex patterns (max %d)", maxPatternsPerPolicy)}
	}
	normalized := make([]string, 0, len(patterns))
	for i, pattern := range patterns {
		pattern = strings.TrimSpace(pattern)
		if pattern == "" {
			return nil, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Regex pattern at index %d is required", i)}
		}
		if len(pattern) > maxPatternLength {
			return nil, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Regex pattern at index %d exceeds maximum length of %d characters", i, maxPatternLength)}
		}
		if _, err := regexp.Compile(pattern); err != nil {
			return nil, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Invalid regular expression pattern at index %d", i)}
		}
		normalized = append(normalized, pattern)
	}
	return normalized, nil
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

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any) error {
	if s.DB == nil || userID == "" {
		return nil
	}
	payload := "{}"
	if details != nil {
		encoded, err := json.Marshal(details)
		if err != nil {
			return err
		}
		payload = string(encoded)
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, $3, $4, $5, $6::jsonb)
`, uuid.NewString(), userID, action, "KeystrokePolicy", targetID, payload)
	return err
}
