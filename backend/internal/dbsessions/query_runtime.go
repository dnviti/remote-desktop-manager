package dbsessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

var ErrQueryRuntimeUnsupported = errors.New("database session runtime is unsupported for this session")

type ownedQueryRequest struct {
	SQL string `json:"sql"`
}

type ownedIntrospectionRequest struct {
	Type   string `json:"type"`
	Target string `json:"target,omitempty"`
}

type ownedConnectionSnapshot struct {
	ID         string
	Host       string
	Port       int
	DBSettings json.RawMessage
}

type ownedQueryRuntime struct {
	State                   *sessions.SessionState
	Connection              ownedConnectionSnapshot
	Target                  *contracts.DatabaseTarget
	Protocol                string
	SessionConfig           *contracts.DatabaseSessionConfig
	UsesOverrideCredentials bool
	DatabaseName            string
	GatewayID               string
	InstanceID              string
}

func (s Service) ShouldHandleOwnedQueryRuntime(ctx context.Context, userID, tenantID, sessionID string) (bool, error) {
	_, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, ErrQueryRuntimeUnsupported) {
		return false, nil
	}
	return false, err
}

func (s Service) HandleOwnedQuery(w http.ResponseWriter, r *http.Request, userID, tenantID, tenantRole, ipAddress string) {
	var payload ownedQueryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.executeOwnedQuery(r.Context(), userID, tenantID, tenantRole, r.PathValue("sessionId"), payload.SQL, ipAddress)
	if err != nil {
		writeOwnedQueryError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleOwnedSchema(w http.ResponseWriter, r *http.Request, userID, tenantID string) {
	result, err := s.fetchOwnedSchema(r.Context(), userID, tenantID, r.PathValue("sessionId"))
	if err != nil {
		writeOwnedQueryError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleOwnedExplain(w http.ResponseWriter, r *http.Request, userID, tenantID, tenantRole, ipAddress string) {
	var payload ownedQueryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.explainOwnedQuery(r.Context(), userID, tenantID, tenantRole, r.PathValue("sessionId"), payload.SQL, ipAddress)
	if err != nil {
		writeOwnedQueryError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleOwnedIntrospect(w http.ResponseWriter, r *http.Request, userID, tenantID string) {
	var payload ownedIntrospectionRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.introspectOwnedQuery(r.Context(), userID, tenantID, r.PathValue("sessionId"), payload.Type, payload.Target)
	if err != nil {
		writeOwnedQueryError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) executeOwnedQuery(ctx context.Context, userID, tenantID, tenantRole, sessionID, sqlText, ipAddress string) (contracts.QueryExecutionResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	queryType := classifyDBQuery(sqlText)
	tablesAccessed := extractTablesAccessed(sqlText)
	primaryTable := ""
	if len(tablesAccessed) > 0 {
		primaryTable = tablesAccessed[0]
	}

	if err := validateWritableQueryAccess(queryType, tenantRole, false); err != nil {
		blockReason := err.Error()
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": blockReason,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, err
	}

	firewallResult := s.evaluateFirewall(ctx, tenantID, sqlText, runtime.DatabaseName, primaryTable)
	if !firewallResult.Allowed {
		blockReason := "Blocked by SQL firewall"
		if strings.TrimSpace(firewallResult.RuleName) != "" {
			blockReason = "Blocked by firewall rule: " + firewallResult.RuleName
		}
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":      sessionID,
			"protocol":       "DATABASE",
			"queryType":      string(queryType),
			"blockReason":    blockReason,
			"firewallRule":   firewallResult.RuleName,
			"firewallAction": firewallResult.Action,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, &requestError{status: http.StatusForbidden, message: blockReason}
	}
	if firewallResult.Matched && firewallResult.Action != "BLOCK" {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_FIREWALL_ALERT", runtime.Connection.ID, map[string]any{
			"sessionId":      sessionID,
			"protocol":       "DATABASE",
			"queryType":      string(queryType),
			"tablesAccessed": tablesAccessed,
			"firewallAction": firewallResult.Action,
			"firewallRule":   firewallResult.RuleName,
		}, ipAddress)
	}

	rateLimit := s.evaluateRateLimit(ctx, userID, tenantID, queryType, tenantRole, runtime.DatabaseName, primaryTable)
	if rateLimit.Matched && !rateLimit.Allowed {
		blockReason := "Rate limit exceeded: " + rateLimit.PolicyName
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":       sessionID,
			"protocol":        "DATABASE",
			"queryType":       string(queryType),
			"blockReason":     blockReason,
			"rateLimitPolicy": rateLimit.PolicyName,
			"retryAfterMs":    rateLimit.RetryAfterMS,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, &requestError{status: http.StatusTooManyRequests, message: blockReason}
	}
	if rateLimit.Matched && rateLimit.RetryAfterMS > 0 {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_RATE_LIMITED", runtime.Connection.ID, map[string]any{
			"sessionId":       sessionID,
			"protocol":        "DATABASE",
			"queryType":       string(queryType),
			"rateLimitPolicy": rateLimit.PolicyName,
			"action":          rateLimit.Action,
			"remaining":       rateLimit.Remaining,
		}, ipAddress)
	}

	result, err := s.executeViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryExecutionRequest{
		SQL:     sqlText,
		MaxRows: queryMaxRows(),
		Target:  runtime.Target,
	})
	if err != nil {
		return contracts.QueryExecutionResponse{}, classifyQueryOperationError(err)
	}

	var executionPlan any
	if shouldCaptureExecutionPlan(runtime.Protocol) {
		if plan, planErr := s.explainViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryPlanRequest{
			SQL:    sqlText,
			Target: runtime.Target,
		}); planErr == nil && plan.Supported {
			executionPlan = plan
		}
	}

	policies := s.loadMaskingPolicies(ctx, tenantID)
	maskedColumns := findMaskedColumns(policies, result.Columns, tenantRole, runtime.DatabaseName, primaryTable)
	if len(maskedColumns) > 0 {
		result.Rows = applyMasking(result.Rows, maskedColumns)
	}

	rowsAffected := result.RowCount
	executionTimeMS := int(result.DurationMs)
	firewallNote := ""
	if firewallResult.Matched && firewallResult.Action != "BLOCK" && strings.TrimSpace(firewallResult.RuleName) != "" {
		firewallNote = "Firewall " + firewallResult.Action + ": " + firewallResult.RuleName
	}
	s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sqlText, &rowsAffected, &executionTimeMS, false, firewallNote, executionPlan)
	s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_EXECUTED", runtime.Connection.ID, map[string]any{
		"sessionId":       sessionID,
		"protocol":        "DATABASE",
		"queryType":       string(queryType),
		"tablesAccessed":  tablesAccessed,
		"rowsAffected":    result.RowCount,
		"executionTimeMs": result.DurationMs,
		"firewallAction":  firewallResult.Action,
		"firewallRule":    firewallResult.RuleName,
	}, ipAddress)
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)

	return result, nil
}

func (s Service) fetchOwnedSchema(ctx context.Context, userID, tenantID, sessionID string) (contracts.SchemaInfo, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	result, err := s.fetchSchemaViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.SchemaFetchRequest{Target: runtime.Target})
	if err != nil {
		return contracts.SchemaInfo{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) explainOwnedQuery(ctx context.Context, userID, tenantID, tenantRole, sessionID, sqlText, ipAddress string) (contracts.QueryPlanResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}

	queryType := classifyDBQuery(sqlText)
	tablesAccessed := extractTablesAccessed(sqlText)
	primaryTable := ""
	if len(tablesAccessed) > 0 {
		primaryTable = tablesAccessed[0]
	}

	if err := validateWritableQueryAccess(queryType, tenantRole, true); err != nil {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": err.Error(),
			"context":     "explain",
		}, ipAddress)
		return contracts.QueryPlanResponse{}, err
	}

	firewallResult := s.evaluateFirewall(ctx, tenantID, sqlText, runtime.DatabaseName, primaryTable)
	if !firewallResult.Allowed {
		blockReason := "Blocked by SQL firewall"
		if strings.TrimSpace(firewallResult.RuleName) != "" {
			blockReason = "Blocked by firewall rule: " + firewallResult.RuleName
		}
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": blockReason,
			"context":     "explain",
		}, ipAddress)
		return contracts.QueryPlanResponse{}, &requestError{status: http.StatusForbidden, message: blockReason}
	}

	result, err := s.explainViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryPlanRequest{
		SQL:    sqlText,
		Target: runtime.Target,
	})
	if err != nil {
		return contracts.QueryPlanResponse{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) introspectOwnedQuery(ctx context.Context, userID, tenantID, sessionID, introspectionType, target string) (contracts.QueryIntrospectionResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}

	result, err := s.introspectViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryIntrospectionRequest{
		Type:   introspectionType,
		Target: target,
		DB:     runtime.Target,
	})
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) resolveOwnedQueryRuntime(ctx context.Context, userID, tenantID, sessionID string) (*ownedQueryRuntime, error) {
	if s.Store == nil || s.DB == nil {
		return nil, errors.New("database session dependencies are unavailable")
	}

	state, err := s.Store.LoadOwnedSessionState(ctx, strings.TrimSpace(sessionID), strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	if state.Record.Status == "CLOSED" {
		return nil, sessions.ErrSessionClosed
	}

	var connection ownedConnectionSnapshot
	if err := s.DB.QueryRow(ctx, `
SELECT id, host, port, COALESCE("dbSettings", '{}'::jsonb)::text
FROM "Connection"
WHERE id = $1
`, state.Record.ConnectionID).Scan(&connection.ID, &connection.Host, &connection.Port, &connection.DBSettings); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sessions.ErrSessionNotFound
		}
		return nil, fmt.Errorf("load connection for database session runtime: %w", err)
	}

	settings := parseDatabaseSettings(connection.DBSettings)
	dbProtocol := normalizeDatabaseProtocol(settings.Protocol)
	sessionConfig := sessionConfigFromMetadata(state.Metadata)
	usesOverrideCredentials := metadataBool(state.Metadata, "usesOverrideCredentials")
	if !shouldUseOwnedDatabaseSessionRuntime(dbProtocol, usesOverrideCredentials) {
		return nil, ErrQueryRuntimeUnsupported
	}

	resolveOpts := sshsessions.ResolveConnectionOptions{ExpectedType: "DATABASE"}
	if usesOverrideCredentials {
		username, password, err := resolveOverrideCredentials(state.Metadata, s.ServerEncryptionKey)
		if err != nil {
			return nil, &requestError{status: http.StatusBadGateway, message: "database session override credentials are unavailable"}
		}
		resolveOpts.OverrideUsername = username
		resolveOpts.OverridePassword = password
	}

	resolution, err := s.ConnectionResolver.ResolveConnection(ctx, userID, tenantID, state.Record.ConnectionID, resolveOpts)
	if err != nil {
		return nil, err
	}

	target := buildDatabaseTarget(
		connection.Host,
		connection.Port,
		dbProtocol,
		strings.TrimSpace(settings.DatabaseName),
		resolution.Credentials,
		settings,
		sessionConfig,
	)
	if target == nil {
		return nil, &requestError{status: http.StatusBadGateway, message: "database target is unavailable"}
	}

	gatewayID := ""
	if state.Record.GatewayID != nil {
		gatewayID = strings.TrimSpace(*state.Record.GatewayID)
	}
	instanceID := ""
	if state.Record.InstanceID != nil {
		instanceID = strings.TrimSpace(*state.Record.InstanceID)
	}

	return &ownedQueryRuntime{
		State:                   state,
		Connection:              connection,
		Target:                  target,
		Protocol:                dbProtocol,
		SessionConfig:           sessionConfig,
		UsesOverrideCredentials: usesOverrideCredentials,
		DatabaseName:            target.Database,
		GatewayID:               gatewayID,
		InstanceID:              instanceID,
	}, nil
}

func validateWritableQueryAccess(queryType dbQueryType, tenantRole string, explainOnly bool) error {
	if queryType == dbQueryTypeSelect {
		return nil
	}

	switch strings.ToUpper(strings.TrimSpace(tenantRole)) {
	case "OPERATOR", "ADMIN", "OWNER":
		return nil
	}

	if explainOnly {
		return &requestError{status: http.StatusForbidden, message: "EXPLAIN for " + string(queryType) + " queries requires OPERATOR role or above"}
	}
	return &requestError{status: http.StatusForbidden, message: string(queryType) + " queries require OPERATOR role or above"}
}

func shouldCaptureExecutionPlan(protocol string) bool {
	switch normalizeDatabaseProtocol(protocol) {
	case "postgresql", "mysql":
		return true
	default:
		return false
	}
}

func classifyQueryOperationError(err error) error {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return err
	}
	if errors.Is(err, ErrQueryRuntimeUnsupported) {
		return &requestError{status: http.StatusNotImplemented, message: "Database session runtime is unsupported for this session"}
	}

	lowered := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lowered, "sql is required"),
		strings.Contains(lowered, "multiple sql statements"),
		strings.Contains(lowered, "invalid introspection type"),
		strings.Contains(lowered, "type is required"),
		strings.Contains(lowered, "target is required"),
		strings.Contains(lowered, "unsupported protocol"):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "authentication"),
		strings.Contains(lowered, "password"),
		strings.Contains(lowered, "permission denied"):
		return &requestError{status: http.StatusUnauthorized, message: err.Error()}
	case strings.Contains(lowered, "syntax error"),
		strings.Contains(lowered, "does not exist"),
		strings.Contains(lowered, "unknown column"),
		strings.Contains(lowered, "relation "):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "timeout"),
		strings.Contains(lowered, "timed out"):
		return &requestError{status: http.StatusGatewayTimeout, message: err.Error()}
	default:
		return &requestError{status: http.StatusBadGateway, message: err.Error()}
	}
}

func writeOwnedQueryError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	switch {
	case errors.As(err, &reqErr):
		app.ErrorJSON(w, reqErr.status, reqErr.message)
	case errors.Is(err, ErrQueryRuntimeUnsupported):
		app.ErrorJSON(w, http.StatusNotImplemented, "Database session runtime is unsupported for this session")
	case errors.Is(err, sessions.ErrSessionNotFound):
		app.ErrorJSON(w, http.StatusNotFound, "session not found")
	case errors.Is(err, sessions.ErrSessionClosed):
		app.ErrorJSON(w, http.StatusGone, "session already closed")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func (s Service) touchOwnedSession(ctx context.Context, sessionID string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
UPDATE "ActiveSession"
SET "lastActivityAt" = NOW()
WHERE id = $1
`, sessionID)
	return err
}

func queryMaxRows() int {
	const defaultMaxRows = 10000
	value := strings.TrimSpace(os.Getenv("DB_QUERY_MAX_ROWS"))
	if value == "" {
		return defaultMaxRows
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return defaultMaxRows
	}
	return parsed
}

func (s Service) FetchOwnedSchemaTables(ctx context.Context, userID, tenantID, sessionID string) ([]contracts.SchemaTable, string, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return nil, "", err
	}

	result, err := s.fetchSchemaViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.SchemaFetchRequest{
		Target: runtime.Target,
	})
	if err != nil {
		return nil, runtime.Protocol, classifyQueryOperationError(err)
	}
	return result.Tables, runtime.Protocol, nil
}
