package desktopsessions

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
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type createRequest struct {
	ConnectionID   string `json:"connectionId"`
	Username       string `json:"username,omitempty"`
	Password       string `json:"password,omitempty"`
	Domain         string `json:"domain,omitempty"`
	CredentialMode string `json:"credentialMode,omitempty"`
}

type createResponse struct {
	Token       string      `json:"token"`
	EnableDrive bool        `json:"enableDrive,omitempty"`
	SessionID   string      `json:"sessionId"`
	RecordingID string      `json:"recordingId,omitempty"`
	DLPPolicy   resolvedDLP `json:"dlpPolicy"`
}

type desktopPolicySnapshot struct {
	DLPPolicy        resolvedDLP
	RecordingEnabled bool
	EnforcedSettings *enforcedConnectionSettings
}

type desktopRoute struct {
	GatewayID           string
	InstanceID          string
	GuacdHost           string
	GuacdPort           int
	RoutingDecision     *sessions.RoutingDecision
	RecordingGatewayDir string
}

type desktopConnectionSnapshot struct {
	ID          string
	Type        string
	Host        string
	Port        int
	GatewayID   *string
	EnableDrive bool
	RDPSettings json.RawMessage
	VNCSettings json.RawMessage
	DLPPolicy   json.RawMessage
}

type gatewaySnapshot struct {
	ID            string
	Type          string
	Host          string
	Port          int
	IsManaged     bool
	DeploymentMode string
	TunnelEnabled bool
	LBStrategy    string
}

type managedGatewayInstance struct {
	ID             string
	ContainerName  string
	Host           string
	Port           int
	ActiveSessions int
	CreatedAt      time.Time
}

type sessionErrorContext struct {
	ConnectionID string
	Host         string
	Port         int
	GatewayID    string
}

func (s Service) handleCreateDesktopSession(w http.ResponseWriter, r *http.Request, claims authn.Claims, protocol string) {
	var payload createRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	protocol = strings.ToUpper(strings.TrimSpace(protocol))
	ipAddress := requestIP(r)
	errorCtx := sessionErrorContext{
		ConnectionID: strings.TrimSpace(payload.ConnectionID),
	}

	result, err := s.createDesktopSession(r.Context(), claims, payload, protocol, ipAddress, &errorCtx)
	if err != nil {
		s.recordSessionError(r.Context(), claims.UserID, protocol, errorCtx, ipAddress, err)

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

		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
			return
		}

		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) createDesktopSession(ctx context.Context, claims authn.Claims, payload createRequest, protocol, ipAddress string, errorCtx *sessionErrorContext) (createResponse, error) {
	if s.Store == nil || s.DB == nil {
		return createResponse{}, fmt.Errorf("desktop session dependencies are unavailable")
	}
	if strings.TrimSpace(claims.UserID) == "" {
		return createResponse{}, &requestError{status: http.StatusUnauthorized, message: "Invalid or expired token"}
	}

	payload.ConnectionID = strings.TrimSpace(payload.ConnectionID)
	payload.Username = strings.TrimSpace(payload.Username)
	payload.Password = strings.TrimSpace(payload.Password)
	payload.Domain = strings.TrimSpace(payload.Domain)
	payload.CredentialMode = normalizeCredentialMode(payload.CredentialMode)

	if payload.ConnectionID == "" {
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "connectionId is required"}
	}
	if payload.CredentialMode != "domain" && (payload.Username == "") != (payload.Password == "") {
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "Both username and password must be provided together"}
	}

	if claims.TenantID != "" {
		membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
		if err != nil {
			return createResponse{}, fmt.Errorf("resolve tenant membership: %w", err)
		}
		if membership == nil || !membership.Permissions[tenantauth.CanConnect] {
			return createResponse{}, &requestError{status: http.StatusForbidden, message: "Not allowed to start sessions in this tenant"}
		}
	}

	allowed, err := s.checkLateralMovement(ctx, claims.UserID, payload.ConnectionID, ipAddress)
	if err != nil {
		return createResponse{}, err
	}
	if !allowed {
		return createResponse{}, &requestError{
			status:  http.StatusForbidden,
			message: "Session denied: anomalous lateral movement detected. Your account has been temporarily suspended.",
		}
	}

	connection, err := s.Connections.GetConnection(ctx, claims.UserID, claims.TenantID, payload.ConnectionID)
	if err != nil {
		return createResponse{}, err
	}
	conn := desktopConnectionSnapshot{
		ID:          connection.ID,
		Type:        connection.Type,
		Host:        connection.Host,
		Port:        connection.Port,
		GatewayID:   connection.GatewayID,
		EnableDrive: connection.EnableDrive,
		RDPSettings: cloneRawJSON(connection.RDPSettings),
		VNCSettings: cloneRawJSON(connection.VNCSettings),
		DLPPolicy:   cloneRawJSON(connection.DLPPolicy),
	}
	errorCtx.ConnectionID = conn.ID
	errorCtx.Host = conn.Host
	errorCtx.Port = conn.Port
	if conn.GatewayID != nil {
		errorCtx.GatewayID = strings.TrimSpace(*conn.GatewayID)
	}

	switch protocol {
	case "RDP":
		if !strings.EqualFold(conn.Type, "RDP") {
			return createResponse{}, &requestError{status: http.StatusBadRequest, message: "Not an RDP connection"}
		}
	case "VNC":
		if !strings.EqualFold(conn.Type, "VNC") {
			return createResponse{}, &requestError{status: http.StatusBadRequest, message: "Not a VNC connection"}
		}
	default:
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "unsupported protocol"}
	}

	policy, err := s.loadDesktopPolicy(ctx, claims.TenantID, conn.DLPPolicy)
	if err != nil {
		return createResponse{}, err
	}

	route, err := s.resolveDesktopRoute(ctx, claims.TenantID, conn.GatewayID, protocol)
	if err != nil {
		return createResponse{}, err
	}
	errorCtx.GatewayID = route.GatewayID

	switch protocol {
	case "RDP":
		return s.createRDPSession(ctx, claims, payload, ipAddress, conn, policy, route)
	case "VNC":
		return s.createVNCSession(ctx, claims, payload, ipAddress, conn, policy, route)
	default:
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "unsupported protocol"}
	}
}

func (s Service) createRDPSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string, connection desktopConnectionSnapshot, policy desktopPolicySnapshot, route desktopRoute) (createResponse, error) {
	userDefaults, err := s.loadUserRDPDefaults(ctx, claims.UserID)
	if err != nil {
		return createResponse{}, err
	}
	connectionSettings, err := parseJSONPatch[rdpSettingsPatch](connection.RDPSettings)
	if err != nil {
		return createResponse{}, fmt.Errorf("parse connection RDP settings: %w", err)
	}

	var enforcedRDP *rdpSettingsPatch
	if policy.EnforcedSettings != nil {
		enforcedRDP = policy.EnforcedSettings.RDP
	}
	mergedSettings := mergeRDPSettings(userDefaults, connectionSettings, enforcedRDP)

	resolution, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connection.ID, sshsessions.ResolveConnectionOptions{
		ExpectedType:     "RDP",
		OverrideUsername: payload.Username,
		OverridePassword: payload.Password,
		OverrideDomain:   payload.Domain,
		CredentialMode:   payload.CredentialMode,
	})
	if err != nil {
		return createResponse{}, err
	}
	if strings.TrimSpace(resolution.Credentials.Password) == "" && strings.TrimSpace(resolution.Credentials.PrivateKey) != "" {
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "SSH key authentication is not supported for RDP connections"}
	}
	if strings.TrimSpace(resolution.Credentials.Username) == "" || strings.TrimSpace(resolution.Credentials.Password) == "" {
		return createResponse{}, &requestError{status: http.StatusNotFound, message: "Connection not found or credentials unavailable"}
	}

	var (
		recordingID     string
		recordingConfig *recordingSettings
		recordingWidth  *int
		recordingHeight *int
	)
	if s.RecordingEnabled && policy.RecordingEnabled {
		mergedSettings = prepareRecordedRDPSettings(mergedSettings)
		recordingWidth = cloneIntPtr(mergedSettings.Width)
		recordingHeight = cloneIntPtr(mergedSettings.Height)
		recordingID, recordingConfig, err = s.startRecording(ctx, claims.UserID, connection.ID, "RDP", route.RecordingGatewayDir, recordingWidth, recordingHeight)
		if err != nil {
			recordingID = ""
			recordingConfig = nil
		}
	}

	drivePath := ""
	if connection.EnableDrive {
		drivePath = path.Join(s.driveBasePath(), claims.UserID)
	}
	tokenSettings := buildRDPGuacamoleSettings(
		connection.Host,
		connection.Port,
		strings.TrimSpace(resolution.Credentials.Username),
		strings.TrimSpace(resolution.Credentials.Password),
		strings.TrimSpace(resolution.Credentials.Domain),
		connection.EnableDrive,
		drivePath,
		mergedSettings,
		policy.DLPPolicy,
		recordingConfig,
	)

	tokenMetadata := map[string]any{
		"userId":       claims.UserID,
		"connectionId": connection.ID,
	}
	if ipAddress != "" {
		tokenMetadata["ipAddress"] = ipAddress
	}
	if recordingID != "" {
		tokenMetadata["recordingId"] = recordingID
	}

	grant, err := s.IssueGrant(ctx, GrantIssueRequest{
		UserID:       claims.UserID,
		ConnectionID: connection.ID,
		GatewayID:    route.GatewayID,
		InstanceID:   route.InstanceID,
		Protocol:     "RDP",
		IPAddress:    ipAddress,
		SessionMetadata: map[string]any{
			"host":             connection.Host,
			"port":             connection.Port,
			"credentialSource": resolution.Credentials.CredentialSource,
		},
		RoutingDecision: route.RoutingDecision,
		RecordingID:     recordingID,
		Token: DesktopTokenRequest{
			GuacdHost: route.GuacdHost,
			GuacdPort: route.GuacdPort,
			Settings:  tokenSettings,
			Metadata:  tokenMetadata,
		},
	})
	if err != nil {
		return createResponse{}, err
	}

	return createResponse{
		Token:       grant.Token,
		EnableDrive: connection.EnableDrive,
		SessionID:   grant.SessionID,
		RecordingID: firstNonEmpty(grant.RecordingID, recordingID),
		DLPPolicy:   policy.DLPPolicy,
	}, nil
}

func (s Service) createVNCSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string, connection desktopConnectionSnapshot, policy desktopPolicySnapshot, route desktopRoute) (createResponse, error) {
	connectionSettings, err := parseJSONPatch[vncSettingsPatch](connection.VNCSettings)
	if err != nil {
		return createResponse{}, fmt.Errorf("parse connection VNC settings: %w", err)
	}

	var enforcedVNC *vncSettingsPatch
	if policy.EnforcedSettings != nil {
		enforcedVNC = policy.EnforcedSettings.VNC
	}
	mergedSettings := mergeVNCSettings(connectionSettings, enforcedVNC)

	password := ""
	if payload.Username != "" && payload.Password != "" {
		password = payload.Password
	} else {
		resolution, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connection.ID, sshsessions.ResolveConnectionOptions{
			ExpectedType: "VNC",
		})
		if err != nil {
			return createResponse{}, err
		}
		if strings.TrimSpace(resolution.Credentials.Password) == "" && strings.TrimSpace(resolution.Credentials.PrivateKey) != "" {
			return createResponse{}, &requestError{status: http.StatusBadRequest, message: "SSH key authentication is not supported for VNC connections"}
		}
		password = strings.TrimSpace(resolution.Credentials.Password)
	}
	if password == "" {
		return createResponse{}, &requestError{status: http.StatusNotFound, message: "Connection not found or credentials unavailable"}
	}

	var (
		recordingID     string
		recordingConfig *recordingSettings
	)
	if s.RecordingEnabled && policy.RecordingEnabled {
		recordingID, recordingConfig, err = s.startRecording(ctx, claims.UserID, connection.ID, "VNC", route.RecordingGatewayDir, nil, nil)
		if err != nil {
			recordingID = ""
			recordingConfig = nil
		}
	}

	tokenSettings := buildVNCGuacamoleSettings(
		connection.Host,
		connection.Port,
		password,
		mergedSettings,
		policy.DLPPolicy,
		recordingConfig,
	)

	tokenMetadata := map[string]any{
		"userId":       claims.UserID,
		"connectionId": connection.ID,
	}
	if ipAddress != "" {
		tokenMetadata["ipAddress"] = ipAddress
	}
	if recordingID != "" {
		tokenMetadata["recordingId"] = recordingID
	}

	grant, err := s.IssueGrant(ctx, GrantIssueRequest{
		UserID:       claims.UserID,
		ConnectionID: connection.ID,
		GatewayID:    route.GatewayID,
		InstanceID:   route.InstanceID,
		Protocol:     "VNC",
		IPAddress:    ipAddress,
		SessionMetadata: map[string]any{
			"host": connection.Host,
			"port": connection.Port,
		},
		RoutingDecision: route.RoutingDecision,
		RecordingID:     recordingID,
		Token: DesktopTokenRequest{
			GuacdHost: route.GuacdHost,
			GuacdPort: route.GuacdPort,
			Settings:  tokenSettings,
			Metadata:  tokenMetadata,
		},
	})
	if err != nil {
		return createResponse{}, err
	}

	return createResponse{
		Token:       grant.Token,
		SessionID:   grant.SessionID,
		RecordingID: firstNonEmpty(grant.RecordingID, recordingID),
		DLPPolicy:   policy.DLPPolicy,
	}, nil
}

func (s Service) loadDesktopPolicy(ctx context.Context, tenantID string, connectionDLP json.RawMessage) (desktopPolicySnapshot, error) {
	var (
		tenantDLP resolvedDLP
		enforced  []byte
		recording = true
	)

	if strings.TrimSpace(tenantID) != "" {
		if err := s.DB.QueryRow(ctx, `
SELECT "dlpDisableCopy", "dlpDisablePaste", "dlpDisableDownload", "dlpDisableUpload", "enforcedConnectionSettings", "recordingEnabled"
FROM "Tenant"
WHERE id = $1
`, tenantID).Scan(
			&tenantDLP.DisableCopy,
			&tenantDLP.DisablePaste,
			&tenantDLP.DisableDownload,
			&tenantDLP.DisableUpload,
			&enforced,
			&recording,
		); err != nil {
			return desktopPolicySnapshot{}, fmt.Errorf("load tenant desktop policy: %w", err)
		}
	}

	connectionPolicy, err := parseJSONPatch[dlpPolicy](connectionDLP)
	if err != nil {
		return desktopPolicySnapshot{}, fmt.Errorf("parse connection DLP policy: %w", err)
	}
	enforcedSettings, err := parseJSONPatch[enforcedConnectionSettings](json.RawMessage(enforced))
	if err != nil {
		return desktopPolicySnapshot{}, fmt.Errorf("parse tenant enforced connection settings: %w", err)
	}

	return desktopPolicySnapshot{
		DLPPolicy:        mergeDLPPolicy(tenantDLP, connectionPolicy),
		RecordingEnabled: recording,
		EnforcedSettings: enforcedSettings,
	}, nil
}

func (s Service) loadUserRDPDefaults(ctx context.Context, userID string) (*rdpSettingsPatch, error) {
	var raw []byte
	if err := s.DB.QueryRow(ctx, `SELECT "rdpDefaults" FROM "User" WHERE id = $1`, userID).Scan(&raw); err != nil {
		return nil, fmt.Errorf("load user RDP defaults: %w", err)
	}
	settings, err := parseJSONPatch[rdpSettingsPatch](json.RawMessage(raw))
	if err != nil {
		return nil, fmt.Errorf("parse user RDP defaults: %w", err)
	}
	return settings, nil
}

func (s Service) resolveDesktopRoute(ctx context.Context, tenantID string, explicitGatewayID *string, protocol string) (desktopRoute, error) {
	gateway, err := s.loadRoutingGateway(ctx, tenantID, explicitGatewayID)
	if err != nil {
		return desktopRoute{}, err
	}
	if gateway == nil {
		return desktopRoute{}, &requestError{
			status:  http.StatusServiceUnavailable,
			message: fmt.Sprintf("No gateway available. A connected gateway is required for all connections. Deploy and connect a GUACD gateway to enable %s sessions.", protocol),
		}
	}
	if gateway.Type != "GUACD" {
		return desktopRoute{}, &requestError{
			status:  http.StatusBadRequest,
			message: fmt.Sprintf("Connection gateway must be of type GUACD for %s connections", protocol),
		}
	}

	route := desktopRoute{
		GatewayID:           gateway.ID,
		GuacdHost:           gateway.Host,
		GuacdPort:           gateway.Port,
		RecordingGatewayDir: "default",
	}

	if strings.EqualFold(strings.TrimSpace(gateway.DeploymentMode), "MANAGED_GROUP") {
		selected, err := s.selectManagedInstance(ctx, gateway.ID, gateway.LBStrategy)
		if err != nil {
			return desktopRoute{}, err
		}
		if selected == nil && !gateway.TunnelEnabled {
			return desktopRoute{}, &requestError{
				status:  http.StatusServiceUnavailable,
				message: "No healthy gateway instances available. The gateway may be scaling — please try again.",
			}
		}
		if selected != nil {
			route.InstanceID = selected.ID
			route.GuacdHost = selected.Host
			route.GuacdPort = selected.Port
			route.RecordingGatewayDir = selected.ContainerName
			route.RoutingDecision = &sessions.RoutingDecision{
				Strategy:             strings.TrimSpace(gateway.LBStrategy),
				CandidateCount:       s.selectedCandidatesCount(ctx, gateway.ID),
				SelectedSessionCount: selected.ActiveSessions,
			}
			if route.RoutingDecision.CandidateCount == 0 {
				route.RoutingDecision.CandidateCount = 1
			}
		}
	}

	if gateway.TunnelEnabled {
		proxy, err := s.ConnectionResolver.CreateTunnelProxy(ctx, gateway.ID, "127.0.0.1", route.GuacdPort)
		if err != nil {
			return desktopRoute{}, err
		}
		route.GuacdHost = strings.TrimSpace(proxy.Host)
		route.GuacdPort = proxy.Port
	}

	return route, nil
}

func (s Service) loadRoutingGateway(ctx context.Context, tenantID string, explicitGatewayID *string) (*gatewaySnapshot, error) {
	if explicitGatewayID != nil && strings.TrimSpace(*explicitGatewayID) != "" {
		gateway, err := s.loadGatewayByID(ctx, strings.TrimSpace(*explicitGatewayID))
		if err != nil {
			return nil, err
		}
		if gateway != nil {
			return gateway, nil
		}
	}

	return s.loadDefaultGateway(ctx, tenantID)
}

func (s Service) loadGatewayByID(ctx context.Context, gatewayID string) (*gatewaySnapshot, error) {
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
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
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
  AND type = 'GUACD'::"GatewayType"
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
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
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
	i."containerName",
	i.host,
	i.port,
	i."createdAt",
	COUNT(sess.id)::int AS active_sessions
FROM "ManagedGatewayInstance" i
LEFT JOIN "ActiveSession" sess
	ON sess."instanceId" = i.id
	AND sess.status <> 'CLOSED'::"SessionStatus"
WHERE i."gatewayId" = $1
  AND i.status = 'RUNNING'::"ManagedInstanceStatus"
  AND COALESCE(i."healthStatus", '') = 'healthy'
GROUP BY i.id, i."containerName", i.host, i.port, i."createdAt"
ORDER BY i."createdAt" ASC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("load managed gateway instances: %w", err)
	}
	defer rows.Close()

	instances := make([]managedGatewayInstance, 0)
	for rows.Next() {
		var item managedGatewayInstance
		if err := rows.Scan(&item.ID, &item.ContainerName, &item.Host, &item.Port, &item.CreatedAt, &item.ActiveSessions); err != nil {
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

func (s Service) selectedCandidatesCount(ctx context.Context, gatewayID string) int {
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

func (s Service) startRecording(ctx context.Context, userID, connectionID, protocol, gatewayDir string, width, height *int) (string, *recordingSettings, error) {
	plan, err := buildRecordingPlan(s.recordingRoot(), userID, connectionID, protocol, "guac", gatewayDir, time.Now().UTC())
	if err != nil {
		return "", nil, err
	}
	if err := os.MkdirAll(plan.HostDir, 0o777); err != nil {
		return "", nil, err
	}
	_ = os.Chmod(plan.HostDir, 0o777)
	parentDir := filepath.Dir(plan.HostDir)
	if parentDir != "" && parentDir != "." {
		_ = os.Chmod(parentDir, 0o777)
	}

	recordingID := uuid.NewString()
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "SessionRecording" (
	id, "userId", "connectionId", protocol, "filePath", width, height, format, status
) VALUES (
	$1, $2, $3, $4::"SessionProtocol", $5, $6, $7, 'guac', 'RECORDING'::"RecordingStatus"
)
`, recordingID, userID, connectionID, protocol, plan.HostPath, width, height); err != nil {
		return "", nil, fmt.Errorf("insert session recording: %w", err)
	}

	s.insertRecordingAudit(ctx, recordingID, userID, connectionID, protocol)

	return recordingID, &recordingSettings{
		RecordingPath: plan.GuacdDir,
		RecordingName: plan.GuacdName,
	}, nil
}

func (s Service) insertRecordingAudit(ctx context.Context, recordingID, userID, connectionID, protocol string) {
	details, err := json.Marshal(map[string]any{
		"recordingId":  recordingID,
		"protocol":     protocol,
		"connectionId": connectionID,
	})
	if err != nil {
		return
	}

	_, _ = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, 'RECORDING_START'::"AuditAction", 'Recording', $3, $4::jsonb)
`, uuid.NewString(), strings.TrimSpace(userID), recordingID, string(details))
}

func (s Service) recordSessionError(ctx context.Context, userID, protocol string, details sessionErrorContext, ipAddress string, err error) {
	if s.DB == nil || strings.TrimSpace(details.ConnectionID) == "" {
		return
	}

	rawDetails, marshalErr := json.Marshal(map[string]any{
		"protocol": protocol,
		"error":    err.Error(),
		"host":     emptyToNil(details.Host),
		"port":     zeroToNil(details.Port),
	})
	if marshalErr != nil {
		return
	}

	_, _ = s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, "targetType", "targetId", details, "ipAddress", "gatewayId", "geoCoords", flags
		) VALUES (
			$1, NULLIF($2, ''), 'SESSION_ERROR'::"AuditAction", 'Connection', NULLIF($3, ''), $4::jsonb, NULLIF($5, ''), NULLIF($6, ''), ARRAY[]::double precision[], ARRAY[]::text[]
		)`,
		uuid.NewString(),
		strings.TrimSpace(userID),
		details.ConnectionID,
		string(rawDetails),
		strings.TrimSpace(ipAddress),
		strings.TrimSpace(details.GatewayID),
	)
}

func (s Service) recordingRoot() string {
	root := strings.TrimSpace(s.RecordingPath)
	if root == "" {
		return guacdRecordRoot
	}
	return root
}

func (s Service) driveBasePath() string {
	basePath := strings.TrimSpace(s.DriveBasePath)
	if basePath == "" {
		return "/guacd-drive"
	}
	return basePath
}

func normalizeCredentialMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "domain":
		return "domain"
	case "manual":
		return "manual"
	default:
		return "saved"
	}
}

func cloneRawJSON(value json.RawMessage) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func emptyToNil(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}

func zeroToNil(value int) any {
	if value == 0 {
		return nil
	}
	return value
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

func (s Service) checkLateralMovement(ctx context.Context, userID, connectionID, ipAddress string) (bool, error) {
	if !parseEnvBool("LATERAL_MOVEMENT_DETECTION_ENABLED", true) {
		return true, nil
	}

	windowMinutes := parseEnvInt("LATERAL_MOVEMENT_WINDOW_MINUTES", 5)
	threshold := parseEnvInt("LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS", 10)
	lockoutMinutes := parseEnvInt("LATERAL_MOVEMENT_LOCKOUT_MINUTES", 30)

	since := time.Now().UTC().Add(-time.Duration(windowMinutes) * time.Minute)
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT "targetId"
FROM "AuditLog"
WHERE "userId" = $1
  AND action = 'SESSION_START'::"AuditAction"
  AND "createdAt" >= $2
  AND "targetId" IS NOT NULL
`, userID, since)
	if err != nil {
		return false, fmt.Errorf("check lateral movement: %w", err)
	}
	defer rows.Close()

	targets := map[string]struct{}{connectionID: {}}
	for rows.Next() {
		var targetID string
		if err := rows.Scan(&targetID); err != nil {
			return false, fmt.Errorf("scan lateral movement target: %w", err)
		}
		if targetID != "" {
			targets[targetID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate lateral movement targets: %w", err)
	}
	if len(targets) <= threshold {
		return true, nil
	}

	details, _ := json.Marshal(map[string]any{
		"distinctTargets":     len(targets),
		"threshold":           threshold,
		"windowMinutes":       windowMinutes,
		"recentConnectionIds": mapKeys(targets),
		"deniedConnectionId":  connectionID,
	})
	_, _ = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress", "createdAt")
VALUES ($1, $2, 'ANOMALOUS_LATERAL_MOVEMENT'::"AuditAction", 'User', $3, $4::jsonb, NULLIF($5, ''), NOW())
`, uuid.NewString(), userID, userID, string(details), ipAddress)
	_, _ = s.DB.Exec(ctx, `UPDATE "User" SET "lockedUntil" = $2 WHERE id = $1`, userID, time.Now().UTC().Add(time.Duration(lockoutMinutes)*time.Minute))
	return false, nil
}

func mapKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}

func parseEnvBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
