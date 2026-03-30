package syncprofiles

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	neturl "net/url"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var ErrLegacySyncProfileFlow = errors.New("legacy sync profile flow required")

var roleHierarchy = map[string]int{
	"GUEST":      1,
	"AUDITOR":    2,
	"CONSULTANT": 3,
	"MEMBER":     4,
	"OPERATOR":   5,
	"ADMIN":      6,
	"OWNER":      7,
}

type Service struct {
	DB                  *pgxpool.Pool
	ServerEncryptionKey []byte
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type encryptedField struct {
	Ciphertext string
	IV         string
	Tag        string
}

type syncProfileConfig struct {
	URL              string            `json:"url"`
	Filters          map[string]string `json:"filters"`
	PlatformMapping  map[string]string `json:"platformMapping"`
	DefaultProtocol  string            `json:"defaultProtocol"`
	DefaultPort      map[string]int    `json:"defaultPort"`
	ConflictStrategy string            `json:"conflictStrategy"`
}

type syncProfileResponse struct {
	ID              string            `json:"id"`
	Name            string            `json:"name"`
	TenantID        string            `json:"tenantId"`
	Provider        string            `json:"provider"`
	Config          syncProfileConfig `json:"config"`
	CronExpression  *string           `json:"cronExpression"`
	Enabled         bool              `json:"enabled"`
	TeamID          *string           `json:"teamId"`
	LastSyncAt      *time.Time        `json:"lastSyncAt"`
	LastSyncStatus  *string           `json:"lastSyncStatus"`
	LastSyncDetails json.RawMessage   `json:"lastSyncDetails"`
	CreatedByID     string            `json:"createdById"`
	CreatedAt       time.Time         `json:"createdAt"`
	UpdatedAt       time.Time         `json:"updatedAt"`
	HasAPIToken     bool              `json:"hasApiToken"`
}

type syncLogEntry struct {
	ID            string          `json:"id"`
	SyncProfileID string          `json:"syncProfileId"`
	Status        string          `json:"status"`
	StartedAt     time.Time       `json:"startedAt"`
	CompletedAt   *time.Time      `json:"completedAt"`
	Details       json.RawMessage `json:"details"`
	TriggeredBy   string          `json:"triggeredBy"`
}

type syncLogsResponse struct {
	Logs  []syncLogEntry `json:"logs"`
	Total int            `json:"total"`
	Page  int            `json:"page"`
	Limit int            `json:"limit"`
}

type createPayload struct {
	Name             string            `json:"name"`
	Provider         string            `json:"provider"`
	URL              string            `json:"url"`
	APIToken         string            `json:"apiToken"`
	Filters          map[string]string `json:"filters"`
	PlatformMapping  map[string]string `json:"platformMapping"`
	DefaultProtocol  *string           `json:"defaultProtocol"`
	DefaultPort      map[string]int    `json:"defaultPort"`
	ConflictStrategy *string           `json:"conflictStrategy"`
	CronExpression   *string           `json:"cronExpression"`
	TeamID           *string           `json:"teamId"`
}

type optionalNullableString struct {
	Present bool
	Value   *string
}

func (o *optionalNullableString) UnmarshalJSON(data []byte) error {
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

type updatePayload struct {
	Name             *string                `json:"name"`
	URL              *string                `json:"url"`
	APIToken         *string                `json:"apiToken"`
	Filters          *map[string]string     `json:"filters"`
	PlatformMapping  *map[string]string     `json:"platformMapping"`
	DefaultProtocol  *string                `json:"defaultProtocol"`
	DefaultPort      *map[string]int        `json:"defaultPort"`
	ConflictStrategy *string                `json:"conflictStrategy"`
	CronExpression   optionalNullableString `json:"cronExpression"`
	Enabled          *bool                  `json:"enabled"`
	TeamID           optionalNullableString `json:"teamId"`
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	items, err := s.ListProfiles(r.Context(), claims.TenantID)
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
	item, err := s.GetProfile(r.Context(), r.PathValue("id"), claims.TenantID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Sync profile not found")
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
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return nil
	}
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	item, err := s.CreateProfile(r.Context(), claims, payload)
	if err != nil {
		if errors.Is(err, ErrLegacySyncProfileFlow) {
			return err
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusCreated, item)
	return nil
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return nil
	}
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	item, err := s.UpdateProfile(r.Context(), claims, r.PathValue("id"), payload)
	if err != nil {
		if errors.Is(err, ErrLegacySyncProfileFlow) {
			return err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Sync profile not found")
			return nil
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusOK, item)
	return nil
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return nil
	}
	if err := s.DeleteProfile(r.Context(), claims, r.PathValue("id")); err != nil {
		if errors.Is(err, ErrLegacySyncProfileFlow) {
			return err
		}
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Sync profile not found")
			return nil
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	w.WriteHeader(http.StatusNoContent)
	return nil
}

func (s Service) HandleLogs(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	page := parsePositiveInt(r.URL.Query().Get("page"), 1)
	limit := parsePositiveInt(r.URL.Query().Get("limit"), 20)
	if limit > 100 {
		limit = 100
	}
	result, err := s.GetLogs(r.Context(), r.PathValue("id"), claims.TenantID, page, limit)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Sync profile not found")
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

func (s Service) ListProfiles(ctx context.Context, tenantID string) ([]syncProfileResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT id, name, "tenantId", provider::text, config::text, "cronExpression", enabled, "teamId",
       "lastSyncAt", "lastSyncStatus"::text,
       CASE WHEN "lastSyncDetails" IS NULL THEN NULL ELSE "lastSyncDetails"::text END,
       "createdById", "createdAt", "updatedAt", "encryptedApiToken"
FROM "SyncProfile"
WHERE "tenantId" = $1
ORDER BY "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list sync profiles: %w", err)
	}
	defer rows.Close()

	result := make([]syncProfileResponse, 0)
	for rows.Next() {
		item, err := scanProfile(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate sync profiles: %w", err)
	}
	return result, nil
}

func (s Service) GetProfile(ctx context.Context, profileID, tenantID string) (syncProfileResponse, error) {
	if _, err := uuid.Parse(strings.TrimSpace(profileID)); err != nil {
		return syncProfileResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid sync profile id"}
	}
	row := s.DB.QueryRow(ctx, `
SELECT id, name, "tenantId", provider::text, config::text, "cronExpression", enabled, "teamId",
       "lastSyncAt", "lastSyncStatus"::text,
       CASE WHEN "lastSyncDetails" IS NULL THEN NULL ELSE "lastSyncDetails"::text END,
       "createdById", "createdAt", "updatedAt", "encryptedApiToken"
FROM "SyncProfile"
WHERE id = $1 AND "tenantId" = $2
`, profileID, tenantID)
	return scanProfile(row)
}

func (s Service) CreateProfile(ctx context.Context, claims authn.Claims, payload createPayload) (syncProfileResponse, error) {
	if payload.CronExpression != nil {
		return syncProfileResponse{}, ErrLegacySyncProfileFlow
	}
	if len(s.ServerEncryptionKey) == 0 {
		return syncProfileResponse{}, fmt.Errorf("server encryption key is unavailable")
	}

	config, normalizedTeamID, err := s.validateCreatePayload(ctx, claims.TenantID, payload)
	if err != nil {
		return syncProfileResponse{}, err
	}
	encrypted, err := encryptValue(s.ServerEncryptionKey, payload.APIToken)
	if err != nil {
		return syncProfileResponse{}, fmt.Errorf("encrypt sync API token: %w", err)
	}

	configJSON, err := json.Marshal(config)
	if err != nil {
		return syncProfileResponse{}, fmt.Errorf("marshal sync config: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return syncProfileResponse{}, fmt.Errorf("begin sync profile create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(ctx, `
INSERT INTO "SyncProfile" (
  id, name, "tenantId", provider, config, "encryptedApiToken", "apiTokenIV", "apiTokenTag",
  "cronExpression", enabled, "teamId", "createdById", "createdAt", "updatedAt"
)
VALUES (
  $1, $2, $3, $4::"SyncProvider", $5::jsonb, $6, $7, $8, NULL, true, $9, $10, NOW(), NOW()
)
RETURNING id, name, "tenantId", provider::text, config::text, "cronExpression", enabled, "teamId",
          "lastSyncAt", "lastSyncStatus"::text,
          CASE WHEN "lastSyncDetails" IS NULL THEN NULL ELSE "lastSyncDetails"::text END,
          "createdById", "createdAt", "updatedAt", "encryptedApiToken"
`, uuid.NewString(), payload.Name, claims.TenantID, payload.Provider, string(configJSON), encrypted.Ciphertext, encrypted.IV, encrypted.Tag, normalizedTeamID, claims.UserID)

	item, err := scanProfile(row)
	if err != nil {
		return syncProfileResponse{}, err
	}
	if err := insertAuditLog(ctx, tx, claims.UserID, "SYNC_PROFILE_CREATE", item.ID, map[string]any{
		"name":     item.Name,
		"provider": item.Provider,
	}); err != nil {
		return syncProfileResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return syncProfileResponse{}, fmt.Errorf("commit sync profile create: %w", err)
	}
	return item, nil
}

func (s Service) UpdateProfile(ctx context.Context, claims authn.Claims, profileID string, payload updatePayload) (syncProfileResponse, error) {
	current, encryptedPresent, err := s.loadProfileRecord(ctx, profileID, claims.TenantID)
	if err != nil {
		return syncProfileResponse{}, err
	}
	if current.CronExpression != nil || payload.CronExpression.Present {
		return syncProfileResponse{}, ErrLegacySyncProfileFlow
	}

	updatedConfig := current.Config
	if payload.URL != nil {
		updatedConfig.URL = strings.TrimSpace(*payload.URL)
	}
	if payload.Filters != nil {
		updatedConfig.Filters = cloneStringMap(*payload.Filters)
	}
	if payload.PlatformMapping != nil {
		updatedConfig.PlatformMapping = cloneStringMap(*payload.PlatformMapping)
	}
	if payload.DefaultProtocol != nil {
		updatedConfig.DefaultProtocol = strings.TrimSpace(*payload.DefaultProtocol)
	}
	if payload.DefaultPort != nil {
		updatedConfig.DefaultPort = cloneIntMap(*payload.DefaultPort)
	}
	if payload.ConflictStrategy != nil {
		updatedConfig.ConflictStrategy = strings.TrimSpace(*payload.ConflictStrategy)
	}
	if err := validateConfig(updatedConfig); err != nil {
		return syncProfileResponse{}, err
	}

	var (
		nameValue = current.Name
		enabled   = current.Enabled
		teamID    = current.TeamID
	)
	if payload.Name != nil {
		nameValue = strings.TrimSpace(*payload.Name)
	}
	if payload.Enabled != nil {
		enabled = *payload.Enabled
	}
	if payload.TeamID.Present {
		teamID, err = s.normalizeTeamID(ctx, claims.TenantID, payload.TeamID.Value)
		if err != nil {
			return syncProfileResponse{}, err
		}
	}
	if len(nameValue) == 0 || len(nameValue) > 100 {
		return syncProfileResponse{}, &requestError{status: http.StatusBadRequest, message: "name must be between 1 and 100 characters"}
	}

	configJSON, err := json.Marshal(updatedConfig)
	if err != nil {
		return syncProfileResponse{}, fmt.Errorf("marshal sync config: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return syncProfileResponse{}, fmt.Errorf("begin sync profile update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	apiTokenCipher := ""
	apiTokenIV := ""
	apiTokenTag := ""
	hasNewToken := payload.APIToken != nil && strings.TrimSpace(*payload.APIToken) != ""
	if hasNewToken {
		if len(s.ServerEncryptionKey) == 0 {
			return syncProfileResponse{}, fmt.Errorf("server encryption key is unavailable")
		}
		encrypted, err := encryptValue(s.ServerEncryptionKey, strings.TrimSpace(*payload.APIToken))
		if err != nil {
			return syncProfileResponse{}, fmt.Errorf("encrypt sync API token: %w", err)
		}
		apiTokenCipher = encrypted.Ciphertext
		apiTokenIV = encrypted.IV
		apiTokenTag = encrypted.Tag
	}

	row := tx.QueryRow(ctx, `
UPDATE "SyncProfile"
SET name = $3,
    config = $4::jsonb,
    enabled = $5,
    "teamId" = $6,
    "encryptedApiToken" = CASE WHEN $7 = '' THEN "encryptedApiToken" ELSE $7 END,
    "apiTokenIV" = CASE WHEN $8 = '' THEN "apiTokenIV" ELSE $8 END,
    "apiTokenTag" = CASE WHEN $9 = '' THEN "apiTokenTag" ELSE $9 END,
    "updatedAt" = NOW()
WHERE id = $1 AND "tenantId" = $2
RETURNING id, name, "tenantId", provider::text, config::text, "cronExpression", enabled, "teamId",
          "lastSyncAt", "lastSyncStatus"::text,
          CASE WHEN "lastSyncDetails" IS NULL THEN NULL ELSE "lastSyncDetails"::text END,
          "createdById", "createdAt", "updatedAt", "encryptedApiToken"
`, profileID, claims.TenantID, nameValue, string(configJSON), enabled, teamID, apiTokenCipher, apiTokenIV, apiTokenTag)

	item, err := scanProfile(row)
	if err != nil {
		return syncProfileResponse{}, err
	}
	if !hasNewToken {
		item.HasAPIToken = encryptedPresent
	}
	if err := insertAuditLog(ctx, tx, claims.UserID, "SYNC_PROFILE_UPDATE", item.ID, map[string]any{
		"name": item.Name,
	}); err != nil {
		return syncProfileResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return syncProfileResponse{}, fmt.Errorf("commit sync profile update: %w", err)
	}
	return item, nil
}

func (s Service) DeleteProfile(ctx context.Context, claims authn.Claims, profileID string) error {
	current, _, err := s.loadProfileRecord(ctx, profileID, claims.TenantID)
	if err != nil {
		return err
	}
	if current.CronExpression != nil {
		return ErrLegacySyncProfileFlow
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin sync profile delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM "SyncLog" WHERE "syncProfileId" = $1`, profileID); err != nil {
		return fmt.Errorf("delete sync logs: %w", err)
	}
	commandTag, err := tx.Exec(ctx, `DELETE FROM "SyncProfile" WHERE id = $1 AND "tenantId" = $2`, profileID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("delete sync profile: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	if err := insertAuditLog(ctx, tx, claims.UserID, "SYNC_PROFILE_DELETE", profileID, nil); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit sync profile delete: %w", err)
	}
	return nil
}

func (s Service) GetLogs(ctx context.Context, profileID, tenantID string, page, limit int) (syncLogsResponse, error) {
	if _, err := uuid.Parse(strings.TrimSpace(profileID)); err != nil {
		return syncLogsResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid sync profile id"}
	}
	var exists bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "SyncProfile" WHERE id = $1 AND "tenantId" = $2)`, profileID, tenantID).Scan(&exists); err != nil {
		return syncLogsResponse{}, fmt.Errorf("check sync profile: %w", err)
	}
	if !exists {
		return syncLogsResponse{}, pgx.ErrNoRows
	}

	offset := (page - 1) * limit
	rows, err := s.DB.Query(ctx, `
SELECT id, "syncProfileId", status::text, "startedAt", "completedAt",
       CASE WHEN details IS NULL THEN NULL ELSE details::text END, "triggeredBy"
FROM "SyncLog"
WHERE "syncProfileId" = $1
ORDER BY "startedAt" DESC
OFFSET $2 LIMIT $3
`, profileID, offset, limit)
	if err != nil {
		return syncLogsResponse{}, fmt.Errorf("list sync logs: %w", err)
	}
	defer rows.Close()

	logs := make([]syncLogEntry, 0)
	for rows.Next() {
		var (
			item        syncLogEntry
			completedAt sql.NullTime
			details     sql.NullString
		)
		if err := rows.Scan(&item.ID, &item.SyncProfileID, &item.Status, &item.StartedAt, &completedAt, &details, &item.TriggeredBy); err != nil {
			return syncLogsResponse{}, fmt.Errorf("scan sync log: %w", err)
		}
		if completedAt.Valid {
			item.CompletedAt = &completedAt.Time
		}
		if details.Valid {
			item.Details = json.RawMessage(details.String)
		}
		logs = append(logs, item)
	}
	if err := rows.Err(); err != nil {
		return syncLogsResponse{}, fmt.Errorf("iterate sync logs: %w", err)
	}

	var total int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "SyncLog" WHERE "syncProfileId" = $1`, profileID).Scan(&total); err != nil {
		return syncLogsResponse{}, fmt.Errorf("count sync logs: %w", err)
	}
	return syncLogsResponse{Logs: logs, Total: total, Page: page, Limit: limit}, nil
}

func (s Service) validateCreatePayload(ctx context.Context, tenantID string, payload createPayload) (syncProfileConfig, *string, error) {
	if name := strings.TrimSpace(payload.Name); name == "" || len(name) > 100 {
		return syncProfileConfig{}, nil, &requestError{status: http.StatusBadRequest, message: "name must be between 1 and 100 characters"}
	}
	if strings.TrimSpace(payload.Provider) != "NETBOX" {
		return syncProfileConfig{}, nil, &requestError{status: http.StatusBadRequest, message: "provider must be NETBOX"}
	}
	if token := strings.TrimSpace(payload.APIToken); token == "" || len(token) > 500 {
		return syncProfileConfig{}, nil, &requestError{status: http.StatusBadRequest, message: "apiToken must be between 1 and 500 characters"}
	}

	config := syncProfileConfig{
		URL:              strings.TrimSpace(payload.URL),
		Filters:          cloneStringMap(payload.Filters),
		PlatformMapping:  cloneStringMap(payload.PlatformMapping),
		DefaultProtocol:  defaultStringPointer(payload.DefaultProtocol, "SSH"),
		DefaultPort:      cloneIntMap(payload.DefaultPort),
		ConflictStrategy: defaultStringPointer(payload.ConflictStrategy, "update"),
	}
	if err := validateConfig(config); err != nil {
		return syncProfileConfig{}, nil, err
	}

	teamID, err := s.normalizeTeamID(ctx, tenantID, payload.TeamID)
	if err != nil {
		return syncProfileConfig{}, nil, err
	}
	return config, teamID, nil
}

func (s Service) normalizeTeamID(ctx context.Context, tenantID string, teamID *string) (*string, error) {
	if teamID == nil {
		return nil, nil
	}
	trimmed := strings.TrimSpace(*teamID)
	if trimmed == "" {
		return nil, nil
	}
	if _, err := uuid.Parse(trimmed); err != nil {
		return nil, &requestError{status: http.StatusBadRequest, message: "teamId must be a valid UUID"}
	}
	var exists bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "Team" WHERE id = $1 AND "tenantId" = $2)`, trimmed, tenantID).Scan(&exists); err != nil {
		return nil, fmt.Errorf("check team: %w", err)
	}
	if !exists {
		return nil, &requestError{status: http.StatusBadRequest, message: "teamId must belong to the current tenant"}
	}
	return &trimmed, nil
}

func (s Service) loadProfileRecord(ctx context.Context, profileID, tenantID string) (syncProfileResponse, bool, error) {
	item, err := s.GetProfile(ctx, profileID, tenantID)
	if err != nil {
		return syncProfileResponse{}, false, err
	}
	return item, item.HasAPIToken, nil
}

func scanProfile(row interface{ Scan(dest ...any) error }) (syncProfileResponse, error) {
	var (
		item              syncProfileResponse
		configText        string
		cronExpression    sql.NullString
		teamID            sql.NullString
		lastSyncAt        sql.NullTime
		lastSyncStatus    sql.NullString
		lastSyncDetails   sql.NullString
		encryptedAPIToken sql.NullString
	)
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.TenantID,
		&item.Provider,
		&configText,
		&cronExpression,
		&item.Enabled,
		&teamID,
		&lastSyncAt,
		&lastSyncStatus,
		&lastSyncDetails,
		&item.CreatedByID,
		&item.CreatedAt,
		&item.UpdatedAt,
		&encryptedAPIToken,
	); err != nil {
		return syncProfileResponse{}, err
	}
	if err := json.Unmarshal([]byte(configText), &item.Config); err != nil {
		return syncProfileResponse{}, fmt.Errorf("decode sync profile config: %w", err)
	}
	normalizeConfig(&item.Config)
	if cronExpression.Valid {
		item.CronExpression = &cronExpression.String
	}
	if teamID.Valid {
		item.TeamID = &teamID.String
	}
	if lastSyncAt.Valid {
		item.LastSyncAt = &lastSyncAt.Time
	}
	if lastSyncStatus.Valid {
		item.LastSyncStatus = &lastSyncStatus.String
	}
	if lastSyncDetails.Valid {
		item.LastSyncDetails = json.RawMessage(lastSyncDetails.String)
	}
	item.HasAPIToken = encryptedAPIToken.Valid && encryptedAPIToken.String != ""
	return item, nil
}

func validateConfig(config syncProfileConfig) error {
	if config.URL == "" || len(config.URL) > 500 {
		return &requestError{status: http.StatusBadRequest, message: "url must be a valid URL with at most 500 characters"}
	}
	if _, err := neturl.ParseRequestURI(config.URL); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "url must be a valid URL with at most 500 characters"}
	}
	switch config.DefaultProtocol {
	case "SSH", "RDP", "VNC":
	default:
		return &requestError{status: http.StatusBadRequest, message: "defaultProtocol must be SSH, RDP, or VNC"}
	}
	switch config.ConflictStrategy {
	case "update", "skip", "overwrite":
	default:
		return &requestError{status: http.StatusBadRequest, message: "conflictStrategy must be update, skip, or overwrite"}
	}
	for key, value := range config.DefaultPort {
		if strings.TrimSpace(key) == "" || value < 1 || value > 65535 {
			return &requestError{status: http.StatusBadRequest, message: "defaultPort values must be integers between 1 and 65535"}
		}
	}
	return nil
}

func normalizeConfig(config *syncProfileConfig) {
	if config.Filters == nil {
		config.Filters = map[string]string{}
	}
	if config.PlatformMapping == nil {
		config.PlatformMapping = map[string]string{}
	}
	if config.DefaultPort == nil {
		config.DefaultPort = map[string]int{}
	}
	if strings.TrimSpace(config.DefaultProtocol) == "" {
		config.DefaultProtocol = "SSH"
	}
	if strings.TrimSpace(config.ConflictStrategy) == "" {
		config.ConflictStrategy = "update"
	}
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func cloneIntMap(input map[string]int) map[string]int {
	if len(input) == 0 {
		return map[string]int{}
	}
	output := make(map[string]int, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func defaultStringPointer(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func requireTenantAdmin(claims authn.Claims) *requestError {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "You must belong to an organization to perform this action"}
	}
	if roleHierarchy[strings.TrimSpace(claims.TenantRole)] < roleHierarchy["ADMIN"] {
		return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
	return nil
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, action, targetID string, details map[string]any) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, $3, 'SyncProfile', $4, $5::jsonb)
`, uuid.NewString(), userID, action, targetID, string(detailsJSON)); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return encryptedField{}, fmt.Errorf("generate nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	ciphertext := sealed[:len(sealed)-tagSize]
	tag := sealed[len(sealed)-tagSize:]
	return encryptedField{
		Ciphertext: hex.EncodeToString(ciphertext),
		IV:         hex.EncodeToString(nonce),
		Tag:        hex.EncodeToString(tag),
	}, nil
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
