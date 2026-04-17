package desktopsessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
	"github.com/dnviti/arsenale/backend/internal/sessionadmin"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/jackc/pgx/v5"
)

const desktopWebSocketPath = "/guacamole/"

const desktopObserverGrantTTL = 5 * time.Minute

func (s Service) IssueDesktopObserverGrant(ctx context.Context, target sessions.TenantSessionSummary, observerUserID string, request *http.Request) (sessionadmin.DesktopObserveGrantResponse, error) {
	protocol := strings.ToUpper(strings.TrimSpace(target.Protocol))
	_ = request
	if protocol != "RDP" && protocol != "VNC" {
		return sessionadmin.DesktopObserveGrantResponse{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("unsupported protocol %q", target.Protocol)}
	}
	if strings.TrimSpace(target.ID) == "" {
		return sessionadmin.DesktopObserveGrantResponse{}, &requestError{status: http.StatusBadRequest, message: "sessionId is required"}
	}
	if strings.TrimSpace(target.ConnectionID) == "" {
		return sessionadmin.DesktopObserveGrantResponse{}, &requestError{status: http.StatusConflict, message: "Desktop session is missing connection context"}
	}
	if strings.TrimSpace(target.GuacdConnectionID) == "" {
		return sessionadmin.DesktopObserveGrantResponse{}, &requestError{status: http.StatusConflict, message: "Desktop session is not ready for observation yet"}
	}

	route, err := s.resolveDesktopObserveRoute(ctx, target.GatewayID, target.InstanceID)
	if err != nil {
		return sessionadmin.DesktopObserveGrantResponse{}, err
	}
	expiresAt := time.Now().UTC().Add(desktopObserverGrantTTL)

	tokenValue, err := desktopbroker.EncryptToken(s.Secret, buildDesktopObserverConnectionToken(protocol, target, observerUserID, route, expiresAt))
	if err != nil {
		return sessionadmin.DesktopObserveGrantResponse{}, &requestError{status: http.StatusBadRequest, message: err.Error()}
	}

	return sessionadmin.DesktopObserveGrantResponse{
		SessionID:     target.ID,
		Protocol:      protocol,
		Token:         tokenValue,
		ExpiresAt:     expiresAt,
		WebSocketPath: desktopWebSocketPath,
		ReadOnly:      true,
	}, nil
}

func buildDesktopObserverConnectionToken(protocol string, target sessions.TenantSessionSummary, observerUserID string, route desktopRoute, expiresAt time.Time) desktopbroker.ConnectionToken {
	token := desktopbroker.ConnectionToken{}
	token.ExpiresAt = expiresAt.UTC()
	token.Connection.Type = strings.ToLower(strings.TrimSpace(protocol))
	token.Connection.Join = strings.TrimSpace(target.GuacdConnectionID)
	token.Connection.GuacdHost = strings.TrimSpace(route.GuacdHost)
	token.Connection.GuacdPort = route.GuacdPort
	token.Connection.Settings = buildDesktopObserveSettings()
	token.Metadata = normalizeMetadata(map[string]any{
		"userId":           strings.TrimSpace(observerUserID),
		"connectionId":     strings.TrimSpace(target.ConnectionID),
		"observeSessionId": strings.TrimSpace(target.ID),
	})
	return token
}

func (s Service) resolveDesktopObserveRoute(ctx context.Context, gatewayID, instanceID string) (desktopRoute, error) {
	gatewayID = strings.TrimSpace(gatewayID)
	if gatewayID == "" {
		return desktopRoute{}, &requestError{status: http.StatusServiceUnavailable, message: "Observed desktop session is missing gateway routing information"}
	}

	gateway, err := s.loadGatewayByID(ctx, gatewayID)
	if err != nil {
		return desktopRoute{}, err
	}
	if gateway == nil {
		return desktopRoute{}, &requestError{status: http.StatusServiceUnavailable, message: "Observed desktop session gateway is unavailable"}
	}
	if gateway.Type != "GUACD" {
		return desktopRoute{}, &requestError{status: http.StatusServiceUnavailable, message: "Observed desktop session gateway is not a GUACD gateway"}
	}

	route := desktopRoute{
		GatewayID: gateway.ID,
		GuacdHost: gateway.Host,
		GuacdPort: gateway.Port,
	}

	if instanceID = strings.TrimSpace(instanceID); instanceID != "" {
		instance, err := s.loadManagedInstanceByID(ctx, instanceID)
		if err != nil {
			return desktopRoute{}, err
		}
		if instance == nil {
			return desktopRoute{}, &requestError{status: http.StatusServiceUnavailable, message: "Observed desktop session gateway instance is unavailable"}
		}
		route.InstanceID = instance.ID
		route.GuacdHost = instance.Host
		route.GuacdPort = instance.Port
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

func (s Service) loadManagedInstanceByID(ctx context.Context, instanceID string) (*managedGatewayInstance, error) {
	var instance managedGatewayInstance
	if err := s.DB.QueryRow(ctx, `
SELECT id, "containerName", host, port, "createdAt"
FROM "ManagedGatewayInstance"
WHERE id = $1
`, instanceID).Scan(
		&instance.ID,
		&instance.ContainerName,
		&instance.Host,
		&instance.Port,
		&instance.CreatedAt,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load managed gateway instance: %w", err)
	}
	return &instance, nil
}
