package systemsettingsapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const sensitiveMask = "••••••••"

type SettingType string

type SettingDef struct {
	Key             string      `json:"key"`
	EnvVar          string      `json:"envVar"`
	ConfigPath      string      `json:"configPath,omitempty"`
	Type            SettingType `json:"type"`
	Default         any         `json:"default"`
	Options         []string    `json:"options,omitempty"`
	Group           string      `json:"group"`
	Label           string      `json:"label"`
	Description     string      `json:"description"`
	MinEditRole     string      `json:"minEditRole"`
	RestartRequired bool        `json:"restartRequired,omitempty"`
	Sensitive       bool        `json:"sensitive,omitempty"`
}

type SettingValue struct {
	Key             string      `json:"key"`
	Value           any         `json:"value"`
	Source          string      `json:"source"`
	EnvLocked       bool        `json:"envLocked"`
	CanEdit         bool        `json:"canEdit"`
	Type            SettingType `json:"type"`
	Default         any         `json:"default"`
	Options         []string    `json:"options,omitempty"`
	Group           string      `json:"group"`
	Label           string      `json:"label"`
	Description     string      `json:"description"`
	RestartRequired bool        `json:"restartRequired"`
	Sensitive       bool        `json:"sensitive"`
}

type SettingGroup struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Order int    `json:"order"`
}

type updateResult struct {
	Key     string `json:"key"`
	Success bool   `json:"success"`
	Error   string `json:"error,omitempty"`
}

type Service struct {
	DB         *pgxpool.Pool
	TenantAuth tenantauth.Service
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

var (
	loadRegistryOnce sync.Once
	loadRegistryErr  error
	registry         []SettingDef
	groups           []SettingGroup
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	membership, err := s.requireReader(r.Context(), claims)
	if err != nil {
		s.writeError(w, err)
		return
	}

	settings, err := s.listSettings(r.Context(), membership.Role)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"settings": settings,
		"groups":   loadedGroups(),
	})
}

func (s Service) HandleUpdateSingle(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	membership, err := s.requireWriter(r.Context(), claims)
	if err != nil {
		s.writeError(w, err)
		return
	}

	var payload struct {
		Value any `json:"value"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.setSetting(r.Context(), strings.TrimSpace(r.PathValue("key")), payload.Value, claims.UserID, membership.Role)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleBulkUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	membership, err := s.requireWriter(r.Context(), claims)
	if err != nil {
		s.writeError(w, err)
		return
	}

	var payload struct {
		Updates []struct {
			Key   string `json:"key"`
			Value any    `json:"value"`
		} `json:"updates"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(payload.Updates) == 0 || len(payload.Updates) > 100 {
		app.ErrorJSON(w, http.StatusBadRequest, "updates must contain between 1 and 100 items")
		return
	}

	results := make([]updateResult, 0, len(payload.Updates))
	for _, update := range payload.Updates {
		key := strings.TrimSpace(update.Key)
		if key == "" {
			results = append(results, updateResult{Key: key, Success: false, Error: "Unknown setting key."})
			continue
		}
		if _, err := s.setSetting(r.Context(), key, update.Value, claims.UserID, membership.Role); err != nil {
			var reqErr *requestError
			if errors.As(err, &reqErr) {
				results = append(results, updateResult{Key: key, Success: false, Error: reqErr.message})
				continue
			}
			results = append(results, updateResult{Key: key, Success: false, Error: "Unknown error"})
			continue
		}
		results = append(results, updateResult{Key: key, Success: true})
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"results": results})
}

func (s Service) listSettings(ctx context.Context, callerRole string) ([]SettingValue, error) {
	if err := ensureRegistryLoaded(); err != nil {
		return nil, err
	}

	dbValues := make(map[string]string)
	if s.DB != nil {
		rows, err := s.DB.Query(ctx, `SELECT key, value FROM "AppConfig"`)
		if err != nil {
			return nil, fmt.Errorf("load system settings: %w", err)
		}
		defer rows.Close()
		for rows.Next() {
			var key string
			var value string
			if err := rows.Scan(&key, &value); err != nil {
				return nil, fmt.Errorf("scan system settings: %w", err)
			}
			dbValues[key] = value
		}
		if err := rows.Err(); err != nil {
			return nil, fmt.Errorf("iterate system settings: %w", err)
		}
	}

	results := make([]SettingValue, 0, len(registry))
	for _, def := range registry {
		envRaw, envLocked := os.LookupEnv(def.EnvVar)
		var (
			value  any
			source string
		)
		switch {
		case envLocked:
			value = parseValue(envRaw, def.Type, def.Default)
			source = "env"
		case dbValues[def.Key] != "":
			value = parseValue(dbValues[def.Key], def.Type, def.Default)
			source = "db"
		default:
			if raw, ok := dbValues[def.Key]; ok {
				value = parseValue(raw, def.Type, def.Default)
				source = "db"
			} else {
				value = def.Default
				source = "default"
			}
		}

		if def.Sensitive && value != nil && fmt.Sprint(value) != "" {
			value = sensitiveMask
		}

		results = append(results, SettingValue{
			Key:             def.Key,
			Value:           value,
			Source:          source,
			EnvLocked:       envLocked,
			CanEdit:         !envLocked && roleAtLeast(callerRole, def.MinEditRole),
			Type:            def.Type,
			Default:         def.Default,
			Options:         def.Options,
			Group:           def.Group,
			Label:           def.Label,
			Description:     def.Description,
			RestartRequired: def.RestartRequired,
			Sensitive:       def.Sensitive,
		})
	}

	return results, nil
}

func (s Service) setSetting(ctx context.Context, key string, value any, userID string, callerRole string) (map[string]any, error) {
	if err := ensureRegistryLoaded(); err != nil {
		return nil, err
	}
	def, ok := lookupDef(key)
	if !ok {
		return nil, &requestError{status: http.StatusBadRequest, message: "Unknown setting key."}
	}
	if !roleAtLeast(callerRole, def.MinEditRole) {
		return nil, &requestError{status: http.StatusForbidden, message: "Insufficient role to modify this setting."}
	}
	if _, envLocked := os.LookupEnv(def.EnvVar); envLocked {
		return nil, &requestError{
			status:  http.StatusForbidden,
			message: fmt.Sprintf("Setting %q is locked by environment variable and cannot be changed via the admin panel.", key),
		}
	}
	if def.Sensitive {
		if raw, ok := value.(string); ok && raw == sensitiveMask {
			return map[string]any{"key": key, "value": sensitiveMask, "source": "db"}, nil
		}
	}
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}

	serialized, redactedValue, err := serializeValue(value, def)
	if err != nil {
		return nil, &requestError{status: http.StatusBadRequest, message: err.Error()}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin system setting update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
INSERT INTO "AppConfig" (key, value, "updatedAt")
VALUES ($1, $2, NOW())
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
`, key, serialized); err != nil {
		return nil, fmt.Errorf("upsert system setting: %w", err)
	}

	if err := insertAuditLog(ctx, tx, userID, key, redactedValue); err != nil {
		return nil, fmt.Errorf("audit system setting update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit system setting update: %w", err)
	}

	return map[string]any{"key": key, "value": value, "source": "db"}, nil
}

func (s Service) requireReader(ctx context.Context, claims authn.Claims) (*tenantauth.Membership, error) {
	return s.requireRole(ctx, claims, map[string]bool{
		"AUDITOR": true,
		"ADMIN":   true,
		"OWNER":   true,
	})
}

func (s Service) requireWriter(ctx context.Context, claims authn.Claims) (*tenantauth.Membership, error) {
	return s.requireRole(ctx, claims, map[string]bool{
		"ADMIN": true,
		"OWNER": true,
	})
}

func (s Service) requireRole(ctx context.Context, claims authn.Claims, allowed map[string]bool) (*tenantauth.Membership, error) {
	if strings.TrimSpace(claims.UserID) == "" || strings.TrimSpace(claims.TenantID) == "" {
		return nil, &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}

	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return nil, fmt.Errorf("resolve tenant membership: %w", err)
	}
	if membership == nil {
		return nil, &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}
	if !allowed[strings.ToUpper(strings.TrimSpace(membership.Role))] {
		return nil, &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
	return membership, nil
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func ensureRegistryLoaded() error {
	loadRegistryOnce.Do(func() {
		if err := json.Unmarshal([]byte(settingsRegistryJSON), &registry); err != nil {
			loadRegistryErr = fmt.Errorf("decode settings registry: %w", err)
			return
		}
		if err := json.Unmarshal([]byte(settingGroupsJSON), &groups); err != nil {
			loadRegistryErr = fmt.Errorf("decode setting groups: %w", err)
			return
		}
	})
	return loadRegistryErr
}

func loadedGroups() []SettingGroup {
	_ = ensureRegistryLoaded()
	out := make([]SettingGroup, len(groups))
	copy(out, groups)
	return out
}

func lookupDef(key string) (SettingDef, bool) {
	for _, def := range registry {
		if def.Key == key {
			return def, true
		}
	}
	return SettingDef{}, false
}

func parseValue(raw string, valueType SettingType, defaultValue any) any {
	if raw == "" {
		return defaultValue
	}
	switch valueType {
	case "boolean":
		return raw == "true" || raw == "1"
	case "number":
		parsed, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
		if err != nil {
			return defaultValue
		}
		return parsed
	case "select", "string", "string[]":
		return raw
	default:
		return raw
	}
}

func serializeValue(value any, def SettingDef) (string, any, error) {
	switch typed := value.(type) {
	case string:
		return typed, redactValue(typed, def.Sensitive), nil
	case bool:
		if typed {
			return "true", redactValue(typed, def.Sensitive), nil
		}
		return "false", redactValue(typed, def.Sensitive), nil
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return "", nil, errors.New("value must be a finite number")
		}
		if math.Trunc(typed) == typed {
			return strconv.FormatInt(int64(typed), 10), redactValue(typed, def.Sensitive), nil
		}
		return strconv.FormatFloat(typed, 'f', -1, 64), redactValue(typed, def.Sensitive), nil
	case int:
		return strconv.Itoa(typed), redactValue(typed, def.Sensitive), nil
	case int32:
		return strconv.FormatInt(int64(typed), 10), redactValue(typed, def.Sensitive), nil
	case int64:
		return strconv.FormatInt(typed, 10), redactValue(typed, def.Sensitive), nil
	default:
		return "", nil, errors.New("value must be a string, number, or boolean")
	}
}

func redactValue(value any, sensitive bool) any {
	if sensitive {
		return "[REDACTED]"
	}
	return value
}

func roleAtLeast(actual, required string) bool {
	ranks := map[string]int{
		"GUEST":      1,
		"AUDITOR":    2,
		"CONSULTANT": 3,
		"MEMBER":     4,
		"OPERATOR":   5,
		"ADMIN":      6,
		"OWNER":      7,
	}
	return ranks[strings.ToUpper(strings.TrimSpace(actual))] >= ranks[strings.ToUpper(strings.TrimSpace(required))]
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, key string, value any) error {
	payload, err := json.Marshal(map[string]any{
		"key":   key,
		"value": value,
	})
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, 'APP_CONFIG_UPDATE', 'system_setting', $3, $4::jsonb)
`, uuid.NewString(), userID, key, payload)
	return err
}
