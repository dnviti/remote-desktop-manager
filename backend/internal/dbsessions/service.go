package dbsessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionIssueRequest struct {
	UserID          string                    `json:"userId"`
	ConnectionID    string                    `json:"connectionId"`
	GatewayID       string                    `json:"gatewayId,omitempty"`
	InstanceID      string                    `json:"instanceId,omitempty"`
	Protocol        string                    `json:"protocol"`
	IPAddress       string                    `json:"ipAddress,omitempty"`
	Username        string                    `json:"username,omitempty"`
	ProxyHost       string                    `json:"proxyHost"`
	ProxyPort       int                       `json:"proxyPort"`
	DatabaseName    string                    `json:"databaseName,omitempty"`
	SessionMetadata map[string]any            `json:"sessionMetadata,omitempty"`
	RoutingDecision *sessions.RoutingDecision `json:"routingDecision,omitempty"`
	Target          *contracts.DatabaseTarget `json:"target,omitempty"`
}

type SessionIssueResponse struct {
	SessionID    string `json:"sessionId"`
	ProxyHost    string `json:"proxyHost"`
	ProxyPort    int    `json:"proxyPort"`
	Protocol     string `json:"protocol"`
	DatabaseName string `json:"databaseName,omitempty"`
	Username     string `json:"username,omitempty"`
}

type OwnedSessionRequest struct {
	UserID string `json:"userId"`
	Reason string `json:"reason,omitempty"`
}

type SessionConfigRequest struct {
	UserID        string                           `json:"userId"`
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
	Target        *contracts.DatabaseTarget        `json:"target,omitempty"`
}

type ownedSessionConfigPayload struct {
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
	Target        *contracts.DatabaseTarget        `json:"target,omitempty"`
}

type Service struct {
	Store               *sessions.Store
	DB                  *pgxpool.Pool
	TenantAuth          tenantauth.Service
	ConnectionResolver  sshsessions.Service
	ServerEncryptionKey []byte
}

type QueryHistoryEntry struct {
	ID              string    `json:"id"`
	QueryText       string    `json:"queryText"`
	QueryType       string    `json:"queryType"`
	ExecutionTimeMS *int      `json:"executionTimeMs"`
	RowsAffected    *int      `json:"rowsAffected"`
	Blocked         bool      `json:"blocked"`
	CreatedAt       time.Time `json:"createdAt"`
	BlockReason     *string   `json:"blockReason,omitempty"`
	ConnectionID    string    `json:"connectionId"`
	TenantID        *string   `json:"tenantId,omitempty"`
}

func (s Service) HandleIssue(w http.ResponseWriter, r *http.Request) {
	var req SessionIssueRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.issueSession(r.Context(), req, true)
	if err != nil {
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

func (s Service) HandleHeartbeat(w http.ResponseWriter, r *http.Request) {
	var req OwnedSessionRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	if err := s.Store.HeartbeatOwnedSession(r.Context(), r.PathValue("sessionId"), req.UserID); err != nil {
		writeLifecycleError(w, err, true)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleOwnedHeartbeat(w http.ResponseWriter, r *http.Request, userID string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if err := s.Store.HeartbeatOwnedSession(r.Context(), r.PathValue("sessionId"), userID); err != nil {
		writeLifecycleError(w, err, true)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleEnd(w http.ResponseWriter, r *http.Request) {
	var req OwnedSessionRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	if err := s.Store.EndOwnedSession(r.Context(), r.PathValue("sessionId"), req.UserID, strings.TrimSpace(req.Reason)); err != nil {
		writeLifecycleError(w, err, false)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleOwnedEnd(w http.ResponseWriter, r *http.Request, userID, reason string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(reason) == "" {
		reason = "client_disconnect"
	}
	if err := s.Store.EndOwnedSession(r.Context(), r.PathValue("sessionId"), userID, strings.TrimSpace(reason)); err != nil {
		writeLifecycleError(w, err, false)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleConfigUpdate(w http.ResponseWriter, r *http.Request) {
	var req SessionConfigRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.UserID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	s.applyOwnedSessionConfig(w, r, req.UserID, req.SessionConfig, req.Target)
}

func (s Service) HandleOwnedConfigUpdate(w http.ResponseWriter, r *http.Request, userID string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	var payload ownedSessionConfigPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	s.applyOwnedSessionConfig(w, r, userID, payload.SessionConfig, payload.Target)
}

func (s Service) applyOwnedSessionConfig(w http.ResponseWriter, r *http.Request, userID string, sessionConfig *contracts.DatabaseSessionConfig, target *contracts.DatabaseTarget) {
	state, err := s.Store.LoadOwnedSessionState(r.Context(), r.PathValue("sessionId"), userID)
	if err != nil {
		writeLifecycleError(w, err, false)
		return
	}
	if state.Record.Status == "CLOSED" {
		app.ErrorJSON(w, http.StatusGone, "session already closed")
		return
	}

	if target != nil {
		gatewayID := ""
		if state.Record.GatewayID != nil {
			gatewayID = strings.TrimSpace(*state.Record.GatewayID)
		}
		instanceID := ""
		if state.Record.InstanceID != nil {
			instanceID = strings.TrimSpace(*state.Record.InstanceID)
		}
		if err := s.validateTargetViaDBProxy(r.Context(), gatewayID, instanceID, target); err != nil {
			app.ErrorJSON(w, classifyConnectivityStatus(err), err.Error())
			return
		}
	}

	metadata := normalizeMetadata(state.Metadata)
	if sessionConfig == nil || isEmptySessionConfig(*sessionConfig) {
		delete(metadata, "sessionConfig")
	} else {
		metadata["sessionConfig"] = normalizeSessionConfig(*sessionConfig)
	}

	if err := s.Store.UpdateOwnedSessionMetadata(r.Context(), state.Record.ID, userID, metadata); err != nil {
		writeLifecycleError(w, err, false)
		return
	}

	activeDatabase := ""
	if target != nil {
		activeDatabase = strings.TrimSpace(target.Database)
	}
	if activeDatabase == "" && sessionConfig != nil {
		activeDatabase = strings.TrimSpace(sessionConfig.ActiveDatabase)
	}
	if activeDatabase == "" {
		activeDatabase = stringValue(metadata["databaseName"])
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"applied":        true,
		"activeDatabase": activeDatabase,
		"sessionConfig":  metadata["sessionConfig"],
	})
}

func (s Service) HandleConfigGet(w http.ResponseWriter, r *http.Request) {
	userID := strings.TrimSpace(r.URL.Query().Get("userId"))
	if userID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "userId is required")
		return
	}

	s.writeOwnedConfig(w, r, userID)
}

func (s Service) HandleOwnedConfigGet(w http.ResponseWriter, r *http.Request, userID string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	s.writeOwnedConfig(w, r, userID)
}

func (s Service) writeOwnedConfig(w http.ResponseWriter, r *http.Request, userID string) {
	state, err := s.Store.LoadOwnedSessionState(r.Context(), r.PathValue("sessionId"), userID)
	if err != nil {
		writeLifecycleError(w, err, false)
		return
	}

	sessionConfig := map[string]any{}
	if raw, ok := state.Metadata["sessionConfig"]; ok {
		if normalized, ok := raw.(map[string]any); ok {
			sessionConfig = normalized
		}
	}

	app.WriteJSON(w, http.StatusOK, sessionConfig)
}

func (s Service) HandleHistory(w http.ResponseWriter, r *http.Request, userID string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}

	limit := 50
	if raw := strings.TrimSpace(r.URL.Query().Get("limit")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 200 {
			app.ErrorJSON(w, http.StatusBadRequest, "limit must be between 1 and 200")
			return
		}
		limit = parsed
	}

	items, err := s.GetQueryHistory(r.Context(), userID, r.PathValue("sessionId"), limit, strings.TrimSpace(r.URL.Query().Get("search")))
	if err != nil {
		writeLifecycleError(w, err, false)
		return
	}

	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) GetQueryHistory(ctx context.Context, userID, sessionID string, limit int, search string) ([]QueryHistoryEntry, error) {
	if s.DB == nil {
		return nil, errors.New("postgres is not configured")
	}
	state, err := s.Store.LoadOwnedSessionState(ctx, sessionID, userID)
	if err != nil {
		return nil, err
	}

	args := []any{userID, state.Record.ConnectionID, limit}
	where := `WHERE "userId" = $1 AND "connectionId" = $2`
	if search != "" {
		args = append(args, "%"+search+"%")
		where += fmt.Sprintf(` AND "queryText" ILIKE $%d`, len(args))
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, "queryText", "queryType"::text, "executionTimeMs", "rowsAffected", blocked, "createdAt", "blockReason", "connectionId", "tenantId"
FROM "DbAuditLog"
`+where+`
ORDER BY "createdAt" DESC
LIMIT $3
`, args...)
	if err != nil {
		return nil, fmt.Errorf("query db history: %w", err)
	}
	defer rows.Close()

	items := make([]QueryHistoryEntry, 0)
	for rows.Next() {
		var (
			item            QueryHistoryEntry
			executionTimeMS sql.NullInt32
			rowsAffected    sql.NullInt32
			blockReason     sql.NullString
			tenantID        sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.QueryText,
			&item.QueryType,
			&executionTimeMS,
			&rowsAffected,
			&item.Blocked,
			&item.CreatedAt,
			&blockReason,
			&item.ConnectionID,
			&tenantID,
		); err != nil {
			return nil, fmt.Errorf("scan db history: %w", err)
		}
		if executionTimeMS.Valid {
			value := int(executionTimeMS.Int32)
			item.ExecutionTimeMS = &value
		}
		if rowsAffected.Valid {
			value := int(rowsAffected.Int32)
			item.RowsAffected = &value
		}
		if blockReason.Valid {
			item.BlockReason = &blockReason.String
		}
		if tenantID.Valid {
			item.TenantID = &tenantID.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate db history: %w", err)
	}
	return items, nil
}

func validateSessionIssueRequest(req SessionIssueRequest) error {
	if strings.TrimSpace(req.UserID) == "" {
		return errors.New("userId is required")
	}
	if strings.TrimSpace(req.ConnectionID) == "" {
		return errors.New("connectionId is required")
	}
	protocol := strings.ToUpper(strings.TrimSpace(req.Protocol))
	if protocol != "DATABASE" {
		return fmt.Errorf("unsupported protocol %q", req.Protocol)
	}
	if strings.TrimSpace(req.ProxyHost) == "" {
		return errors.New("proxyHost is required")
	}
	if req.ProxyPort <= 0 || req.ProxyPort > 65535 {
		return errors.New("proxyPort must be between 1 and 65535")
	}
	if req.Target == nil {
		return errors.New("target is required")
	}
	return nil
}

func classifyConnectivityStatus(err error) int {
	lowered := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lowered, "authentication"), strings.Contains(lowered, "password"):
		return http.StatusUnauthorized
	case strings.Contains(lowered, "timeout"), strings.Contains(lowered, "timed out"):
		return http.StatusGatewayTimeout
	default:
		return http.StatusBadGateway
	}
}

func writeLifecycleError(w http.ResponseWriter, err error, heartbeat bool) {
	switch {
	case errors.Is(err, sessions.ErrSessionNotFound):
		app.ErrorJSON(w, http.StatusNotFound, "session not found")
	case heartbeat && errors.Is(err, sessions.ErrSessionClosed):
		app.ErrorJSON(w, http.StatusGone, "session already closed")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func normalizeMetadata(input map[string]any) map[string]any {
	if len(input) == 0 {
		return map[string]any{}
	}

	out := make(map[string]any, len(input))
	for key, value := range input {
		out[key] = normalizeValue(value)
	}
	return out
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case map[string]any:
		return normalizeMetadata(typed)
	case []any:
		items := make([]any, 0, len(typed))
		for _, item := range typed {
			items = append(items, normalizeValue(item))
		}
		return items
	case nil:
		return nil
	default:
		return typed
	}
}

func normalizeSessionConfig(config contracts.DatabaseSessionConfig) map[string]any {
	result := map[string]any{}
	if strings.TrimSpace(config.ActiveDatabase) != "" {
		result["activeDatabase"] = strings.TrimSpace(config.ActiveDatabase)
	}
	if strings.TrimSpace(config.Timezone) != "" {
		result["timezone"] = strings.TrimSpace(config.Timezone)
	}
	if strings.TrimSpace(config.SearchPath) != "" {
		result["searchPath"] = strings.TrimSpace(config.SearchPath)
	}
	if strings.TrimSpace(config.Encoding) != "" {
		result["encoding"] = strings.TrimSpace(config.Encoding)
	}
	if len(config.InitCommands) > 0 {
		commands := make([]string, 0, len(config.InitCommands))
		for _, command := range config.InitCommands {
			command = strings.TrimSpace(command)
			if command == "" {
				continue
			}
			commands = append(commands, command)
		}
		if len(commands) > 0 {
			result["initCommands"] = commands
		}
	}
	return result
}

func isEmptySessionConfig(config contracts.DatabaseSessionConfig) bool {
	return strings.TrimSpace(config.ActiveDatabase) == "" &&
		strings.TrimSpace(config.Timezone) == "" &&
		strings.TrimSpace(config.SearchPath) == "" &&
		strings.TrimSpace(config.Encoding) == "" &&
		len(config.InitCommands) == 0
}

func stringValue(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		return ""
	}
}
