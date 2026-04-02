package dbsessions

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"math/rand"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
)

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type createRequest struct {
	ConnectionID  string                           `json:"connectionId"`
	Username      string                           `json:"username,omitempty"`
	Password      string                           `json:"password,omitempty"`
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
}

type databaseSettings struct {
	Protocol             string `json:"protocol"`
	DatabaseName         string `json:"databaseName"`
	SSLMode              string `json:"sslMode"`
	OracleConnectionType string `json:"oracleConnectionType"`
	OracleSID            string `json:"oracleSid"`
	OracleServiceName    string `json:"oracleServiceName"`
	OracleRole           string `json:"oracleRole"`
	OracleTNSAlias       string `json:"oracleTnsAlias"`
	OracleTNSDescriptor  string `json:"oracleTnsDescriptor"`
	OracleConnectString  string `json:"oracleConnectString"`
	MSSQLInstanceName    string `json:"mssqlInstanceName"`
	MSSQLAuthMode        string `json:"mssqlAuthMode"`
	DB2DatabaseAlias     string `json:"db2DatabaseAlias"`
}

type gatewaySnapshot struct {
	ID             string
	Type           string
	Host           string
	Port           int
	IsManaged      bool
	DeploymentMode string
	TunnelEnabled  bool
	LBStrategy     string
}

type managedGatewayInstance struct {
	ID             string
	Host           string
	Port           int
	ActiveSessions int
	CreatedAt      time.Time
}

type databaseRoute struct {
	GatewayID       string
	InstanceID      string
	ProxyHost       string
	ProxyPort       int
	RoutingDecision *sessions.RoutingDecision
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload createRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.createSession(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		s.recordSessionError(r.Context(), claims.UserID, strings.TrimSpace(payload.ConnectionID), requestIP(r), err)

		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}

		var resolveErr *sshsessions.ResolveError
		if errors.As(err, &resolveErr) {
			app.ErrorJSON(w, resolveErr.Status, resolveErr.Message)
			return
		}

		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) createSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string) (SessionIssueResponse, error) {
	if s.Store == nil || s.DB == nil {
		return SessionIssueResponse{}, fmt.Errorf("database session dependencies are unavailable")
	}
	if strings.TrimSpace(claims.UserID) == "" {
		return SessionIssueResponse{}, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired token"}
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		return SessionIssueResponse{}, &requestError{
			status:  http.StatusForbidden,
			message: "You must belong to an organization to perform this action",
		}
	}

	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return SessionIssueResponse{}, fmt.Errorf("resolve tenant membership: %w", err)
	}
	if membership == nil || !membership.Permissions[tenantauth.CanConnect] {
		return SessionIssueResponse{}, &requestError{status: http.StatusForbidden, message: "Not allowed to start sessions in this tenant"}
	}

	connectionID := strings.TrimSpace(payload.ConnectionID)
	if connectionID == "" {
		return SessionIssueResponse{}, &requestError{status: http.StatusBadRequest, message: "connectionId is required"}
	}

	resolution, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connectionID, sshsessions.ResolveConnectionOptions{
		ExpectedType:     "DATABASE",
		OverrideUsername: payload.Username,
		OverridePassword: payload.Password,
	})
	if err != nil {
		return SessionIssueResponse{}, err
	}

	settings := parseDatabaseSettings(resolution.Connection.DBSettings)
	dbProtocol := normalizeDatabaseProtocol(settings.Protocol)
	databaseName := strings.TrimSpace(settings.DatabaseName)
	sessionUsername := strings.TrimSpace(resolution.Credentials.Username)
	responseUsername := strings.TrimSpace(payload.Username)
	if responseUsername == "" {
		responseUsername = sessionUsername
	}

	usesOverrideCredentials := hasOverrideCredentials(payload.Username, payload.Password)
	route, err := s.resolveDatabaseRoute(ctx, claims.TenantID, resolution.Connection.GatewayID)
	if err != nil {
		return SessionIssueResponse{}, err
	}

	sessionMetadata := buildSessionMetadata(resolution.Connection.Host, resolution.Connection.Port, route.ProxyHost, route.ProxyPort, dbProtocol, databaseName, sessionUsername, settings, payload.SessionConfig, usesOverrideCredentials)
	if usesOverrideCredentials {
		if err := storeOverridePasswordMetadata(sessionMetadata, payload.Password, s.ServerEncryptionKey); err != nil {
			return SessionIssueResponse{}, fmt.Errorf("store override credentials: %w", err)
		}
	}
	target := buildDatabaseTarget(resolution.Connection.Host, resolution.Connection.Port, dbProtocol, databaseName, resolution.Credentials, settings, payload.SessionConfig)

	result, err := s.issueSession(ctx, SessionIssueRequest{
		UserID:          claims.UserID,
		ConnectionID:    resolution.Connection.ID,
		GatewayID:       route.GatewayID,
		InstanceID:      route.InstanceID,
		Protocol:        "DATABASE",
		IPAddress:       ipAddress,
		Username:        sessionUsername,
		ProxyHost:       route.ProxyHost,
		ProxyPort:       route.ProxyPort,
		DatabaseName:    databaseName,
		SessionMetadata: sessionMetadata,
		RoutingDecision: route.RoutingDecision,
		Target:          target,
	}, shouldUseOwnedDatabaseSessionRuntime(dbProtocol, usesOverrideCredentials))
	if err != nil {
		return SessionIssueResponse{}, err
	}

	result.Username = responseUsername
	return result, nil
}

func (s Service) issueSession(ctx context.Context, req SessionIssueRequest, validateTarget bool) (SessionIssueResponse, error) {
	if err := validateSessionIssueRequest(req); err != nil {
		return SessionIssueResponse{}, &requestError{status: http.StatusBadRequest, message: err.Error()}
	}

	if validateTarget {
		if err := s.validateTargetViaDBProxy(ctx, req.GatewayID, req.InstanceID, req.Target); err != nil {
			return SessionIssueResponse{}, &requestError{status: classifyConnectivityStatus(err), message: err.Error()}
		}
	}

	protocol := strings.ToUpper(strings.TrimSpace(req.Protocol))
	if _, err := s.Store.CloseStaleSessionsForConnection(ctx, req.UserID, req.ConnectionID, protocol); err != nil {
		return SessionIssueResponse{}, err
	}

	sessionID, err := s.Store.StartSession(ctx, sessions.StartSessionParams{
		UserID:          req.UserID,
		ConnectionID:    req.ConnectionID,
		GatewayID:       req.GatewayID,
		InstanceID:      req.InstanceID,
		Protocol:        protocol,
		IPAddress:       req.IPAddress,
		Metadata:        normalizeMetadata(req.SessionMetadata),
		RoutingDecision: req.RoutingDecision,
	})
	if err != nil {
		return SessionIssueResponse{}, err
	}

	return SessionIssueResponse{
		SessionID:    sessionID,
		ProxyHost:    strings.TrimSpace(req.ProxyHost),
		ProxyPort:    req.ProxyPort,
		Protocol:     responseProtocol(req),
		DatabaseName: strings.TrimSpace(req.DatabaseName),
		Username:     strings.TrimSpace(req.Username),
	}, nil
}

func responseProtocol(req SessionIssueRequest) string {
	if req.Target != nil && strings.TrimSpace(req.Target.Protocol) != "" {
		return strings.ToLower(strings.TrimSpace(req.Target.Protocol))
	}
	return strings.ToLower(strings.TrimSpace(req.Protocol))
}

func parseDatabaseSettings(raw json.RawMessage) databaseSettings {
	settings := databaseSettings{Protocol: "postgresql"}
	if len(raw) == 0 {
		return settings
	}
	if err := json.Unmarshal(raw, &settings); err != nil {
		return settings
	}
	settings.Protocol = normalizeDatabaseProtocol(settings.Protocol)
	return settings
}

func normalizeDatabaseProtocol(protocol string) string {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	switch protocol {
	case "", "postgres", "postgresql":
		return "postgresql"
	case "mariadb":
		return "mysql"
	case "sqlserver":
		return "mssql"
	case "mongo":
		return "mongodb"
	default:
		return protocol
	}
}

func hasOverrideCredentials(username, password string) bool {
	return strings.TrimSpace(username) != "" && strings.TrimSpace(password) != ""
}

func shouldUseOwnedDatabaseSessionRuntime(dbProtocol string, usesOverrideCredentials bool) bool {
	_ = usesOverrideCredentials
	if strings.EqualFold(strings.TrimSpace(os.Getenv("DB_PROXY_QUERY_RUNTIME_ENABLED")), "false") {
		return false
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("GO_QUERY_RUNNER_ENABLED")), "false") {
		return false
	}
	switch normalizeDatabaseProtocol(dbProtocol) {
	case "postgresql", "mysql", "mssql", "oracle", "mongodb":
		return true
	default:
		return false
	}
}

func buildSessionMetadata(connectionHost string, connectionPort int, resolvedHost string, resolvedPort int, dbProtocol string, databaseName string, username string, settings databaseSettings, sessionConfig *contracts.DatabaseSessionConfig, usesOverrideCredentials bool) map[string]any {
	metadata := map[string]any{
		"host":                    strings.TrimSpace(connectionHost),
		"port":                    connectionPort,
		"dbProtocol":              normalizeDatabaseProtocol(dbProtocol),
		"databaseName":            strings.TrimSpace(databaseName),
		"username":                strings.TrimSpace(username),
		"resolvedHost":            strings.TrimSpace(resolvedHost),
		"resolvedPort":            resolvedPort,
		"usesOverrideCredentials": usesOverrideCredentials,
	}

	addMetadataString(metadata, "sslMode", settings.SSLMode)
	addMetadataString(metadata, "oracleConnectionType", settings.OracleConnectionType)
	addMetadataString(metadata, "oracleSid", settings.OracleSID)
	addMetadataString(metadata, "oracleServiceName", settings.OracleServiceName)
	addMetadataString(metadata, "oracleRole", settings.OracleRole)
	addMetadataString(metadata, "oracleTnsAlias", settings.OracleTNSAlias)
	addMetadataString(metadata, "oracleTnsDescriptor", settings.OracleTNSDescriptor)
	addMetadataString(metadata, "oracleConnectString", settings.OracleConnectString)
	addMetadataString(metadata, "mssqlInstanceName", settings.MSSQLInstanceName)
	addMetadataString(metadata, "mssqlAuthMode", settings.MSSQLAuthMode)
	addMetadataString(metadata, "db2DatabaseAlias", settings.DB2DatabaseAlias)

	if sessionConfig != nil {
		metadata["sessionConfig"] = normalizeSessionConfig(*sessionConfig)
	}

	return metadata
}

func addMetadataString(metadata map[string]any, key, value string) {
	value = strings.TrimSpace(value)
	if value != "" {
		metadata[key] = value
	}
}

func buildDatabaseTarget(host string, port int, dbProtocol string, databaseName string, credentials sshsessions.ResolvedCredentials, settings databaseSettings, sessionConfig *contracts.DatabaseSessionConfig) *contracts.DatabaseTarget {
	if port <= 0 {
		return nil
	}
	target := &contracts.DatabaseTarget{
		Protocol:             normalizeDatabaseProtocol(dbProtocol),
		Host:                 strings.TrimSpace(host),
		Port:                 port,
		Database:             strings.TrimSpace(databaseName),
		SSLMode:              strings.TrimSpace(settings.SSLMode),
		Username:             strings.TrimSpace(credentials.Username),
		Password:             credentials.Password,
		OracleConnectionType: strings.TrimSpace(settings.OracleConnectionType),
		OracleSID:            strings.TrimSpace(settings.OracleSID),
		OracleServiceName:    strings.TrimSpace(settings.OracleServiceName),
		OracleRole:           strings.TrimSpace(settings.OracleRole),
		OracleTNSAlias:       strings.TrimSpace(settings.OracleTNSAlias),
		OracleTNSDescriptor:  strings.TrimSpace(settings.OracleTNSDescriptor),
		OracleConnectString:  strings.TrimSpace(settings.OracleConnectString),
		MSSQLInstanceName:    strings.TrimSpace(settings.MSSQLInstanceName),
		MSSQLAuthMode:        strings.TrimSpace(settings.MSSQLAuthMode),
		SessionConfig:        sessionConfig,
	}
	if sessionConfig != nil && strings.TrimSpace(sessionConfig.ActiveDatabase) != "" {
		target.Database = strings.TrimSpace(sessionConfig.ActiveDatabase)
	}
	return target
}

func (s Service) resolveDatabaseRoute(ctx context.Context, tenantID string, explicitGatewayID *string) (databaseRoute, error) {
	gateway, err := s.loadRoutingGateway(ctx, tenantID, explicitGatewayID)
	if err != nil {
		return databaseRoute{}, err
	}
	if gateway == nil {
		return databaseRoute{}, &requestError{
			status:  http.StatusServiceUnavailable,
			message: "No gateway available. A connected gateway is required for all connections. Deploy and connect a DB_PROXY gateway to enable database sessions.",
		}
	}
	if gateway.Type != "DB_PROXY" {
		return databaseRoute{}, &requestError{status: http.StatusBadRequest, message: "Connection gateway must be of type DB_PROXY for database connections"}
	}

	route := databaseRoute{
		GatewayID: gateway.ID,
		ProxyHost: gateway.Host,
		ProxyPort: gateway.Port,
	}

	if strings.EqualFold(strings.TrimSpace(gateway.DeploymentMode), "MANAGED_GROUP") {
		selected, err := s.selectManagedInstance(ctx, gateway.ID, gateway.LBStrategy)
		if err != nil {
			return databaseRoute{}, err
		}
		if selected == nil && !gateway.TunnelEnabled {
			return databaseRoute{}, &requestError{
				status:  http.StatusServiceUnavailable,
				message: "No healthy DB proxy instances available. The gateway may be scaling — please try again.",
			}
		}
		if selected != nil {
			route.InstanceID = selected.ID
			route.ProxyHost = selected.Host
			route.ProxyPort = selected.Port
			route.RoutingDecision = &sessions.RoutingDecision{
				Strategy:             strings.TrimSpace(gateway.LBStrategy),
				CandidateCount:       selectedCandidatesCount(ctx, s, gateway.ID),
				SelectedSessionCount: selected.ActiveSessions,
			}
			if route.RoutingDecision.CandidateCount == 0 {
				route.RoutingDecision.CandidateCount = 1
			}
		}
	}

	if gateway.TunnelEnabled {
		proxy, err := s.ConnectionResolver.CreateTunnelProxy(ctx, gateway.ID, "127.0.0.1", route.ProxyPort)
		if err != nil {
			return databaseRoute{}, err
		}
		route.ProxyHost = strings.TrimSpace(proxy.Host)
		route.ProxyPort = proxy.Port
	}

	return route, nil
}

func (s Service) loadRoutingGateway(ctx context.Context, tenantID string, explicitGatewayID *string) (*gatewaySnapshot, error) {
	if explicitGatewayID != nil && strings.TrimSpace(*explicitGatewayID) != "" {
		gateway, err := s.loadGatewayByID(ctx, strings.TrimSpace(*explicitGatewayID))
		if err != nil {
			return nil, err
		}
		return gateway, nil
	}

	return s.loadDefaultGateway(ctx, tenantID)
}

func (s Service) loadGatewayByID(ctx context.Context, gatewayID string) (*gatewaySnapshot, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	var gateway gatewaySnapshot
	if err := s.DB.QueryRow(ctx, `
SELECT id, type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN')
FROM "Gateway"
WHERE id = $1
`, gatewayID).Scan(
		&gateway.ID,
		&gateway.Type,
		&gateway.Host,
		&gateway.Port,
		&gateway.IsManaged,
		&gateway.DeploymentMode,
		&gateway.TunnelEnabled,
		&gateway.LBStrategy,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load gateway: %w", err)
	}
	return &gateway, nil
}

func (s Service) loadDefaultGateway(ctx context.Context, tenantID string) (*gatewaySnapshot, error) {
	if strings.TrimSpace(tenantID) == "" {
		return nil, nil
	}

	var gateway gatewaySnapshot
	if err := s.DB.QueryRow(ctx, `
SELECT id, type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN')
FROM "Gateway"
WHERE "tenantId" = $1
  AND type = 'DB_PROXY'::"GatewayType"
  AND "isDefault" = true
LIMIT 1
`, tenantID).Scan(
		&gateway.ID,
		&gateway.Type,
		&gateway.Host,
		&gateway.Port,
		&gateway.IsManaged,
		&gateway.DeploymentMode,
		&gateway.TunnelEnabled,
		&gateway.LBStrategy,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load default gateway: %w", err)
	}
	return &gateway, nil
}

func (s Service) selectManagedInstance(ctx context.Context, gatewayID, strategy string) (*managedGatewayInstance, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	i.id,
	i.host,
	i.port,
	i."createdAt",
	COUNT(s.id)::int AS active_sessions
FROM "ManagedGatewayInstance" i
LEFT JOIN "ActiveSession" s
	ON s."instanceId" = i.id
	AND s.status <> 'CLOSED'::"SessionStatus"
WHERE i."gatewayId" = $1
  AND i.status = 'RUNNING'::"ManagedInstanceStatus"
  AND COALESCE(i."healthStatus", '') = 'healthy'
GROUP BY i.id, i.host, i.port, i."createdAt"
ORDER BY i."createdAt" ASC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("load managed gateway instances: %w", err)
	}
	defer rows.Close()

	instances := make([]managedGatewayInstance, 0)
	for rows.Next() {
		var item managedGatewayInstance
		if err := rows.Scan(&item.ID, &item.Host, &item.Port, &item.CreatedAt, &item.ActiveSessions); err != nil {
			return nil, fmt.Errorf("scan managed gateway instance: %w", err)
		}
		instances = append(instances, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed gateway instances: %w", err)
	}
	if len(instances) == 0 {
		return nil, nil
	}

	selected := instances[0]
	if strings.EqualFold(strings.TrimSpace(strategy), "LEAST_CONNECTIONS") {
		for _, instance := range instances[1:] {
			if instance.ActiveSessions < selected.ActiveSessions {
				selected = instance
			}
		}
		return &selected, nil
	}

	minSessions := selected.ActiveSessions
	for _, instance := range instances[1:] {
		if instance.ActiveSessions < minSessions {
			minSessions = instance.ActiveSessions
		}
	}
	candidates := make([]managedGatewayInstance, 0, len(instances))
	for _, instance := range instances {
		if instance.ActiveSessions == minSessions {
			candidates = append(candidates, instance)
		}
	}
	if len(candidates) == 1 {
		return &candidates[0], nil
	}

	picker := rand.New(rand.NewSource(time.Now().UnixNano()))
	chosen := candidates[picker.Intn(len(candidates))]
	return &chosen, nil
}

func selectedCandidatesCount(ctx context.Context, s Service, gatewayID string) int {
	if s.DB == nil {
		return 0
	}

	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
  AND status = 'RUNNING'::"ManagedInstanceStatus"
  AND COALESCE("healthStatus", '') = 'healthy'
`, gatewayID).Scan(&count); err != nil {
		return 0
	}
	return count
}

func (s Service) recordSessionError(ctx context.Context, userID, connectionID, ipAddress string, err error) {
	if s.DB == nil || strings.TrimSpace(connectionID) == "" {
		return
	}

	rawDetails, marshalErr := json.Marshal(map[string]any{
		"protocol": "DATABASE",
		"error":    err.Error(),
	})
	if marshalErr != nil {
		return
	}

	_, _ = s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, "targetType", "targetId", details, "ipAddress", "geoCoords", flags
		) VALUES (
			$1, NULLIF($2, ''), 'SESSION_ERROR'::"AuditAction", 'Connection', NULLIF($3, ''), $4::jsonb, NULLIF($5, ''), ARRAY[]::double precision[], ARRAY[]::text[]
		)`,
		uuid.NewString(),
		strings.TrimSpace(userID),
		connectionID,
		string(rawDetails),
		strings.TrimSpace(ipAddress),
	)
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		strings.TrimSpace(r.Header.Get("X-Real-IP")),
		firstForwardedHeader(r.Header.Get("X-Forwarded-For")),
		strings.TrimSpace(r.RemoteAddr),
	} {
		value = stripPort(value)
		value = strings.TrimPrefix(value, "::ffff:")
		if value != "" {
			return value
		}
	}
	return ""
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}

func firstForwardedHeader(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}
