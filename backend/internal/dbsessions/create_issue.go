package dbsessions

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

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
		TenantID:        claims.TenantID,
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
	sessionID, err := s.Store.StartSession(ctx, sessions.StartSessionParams{
		TenantID:        req.TenantID,
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
