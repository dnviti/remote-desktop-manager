package desktopsessions

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

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

	route, err := s.resolveDesktopRoute(ctx, claims.TenantID, conn.GatewayID, protocol, conn.Host, conn.Port, claims.UserID, conn.ID, ipAddress)
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
