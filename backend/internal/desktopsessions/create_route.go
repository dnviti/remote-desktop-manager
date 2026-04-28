package desktopsessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math/rand"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tunnelegress"
	"github.com/jackc/pgx/v5"
)

func (s Service) resolveDesktopRoute(ctx context.Context, tenantID string, explicitGatewayID *string, protocol, targetHost string, targetPort int, userID, connectionID, ipAddress string) (desktopRoute, error) {
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

	// Managed GUACD groups can pin a single healthy instance before optional tunnel wrapping.
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
		if err := s.enforceTunnelEgress(ctx, userID, gateway, connectionID, targetHost, targetPort, protocol, ipAddress); err != nil {
			return desktopRoute{}, err
		}
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
SELECT id, type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN'), COALESCE("egressPolicy", '{"rules":[]}'::jsonb)
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
		&gateway.EgressPolicy,
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
SELECT id, type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN'), COALESCE("egressPolicy", '{"rules":[]}'::jsonb)
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
		&gateway.EgressPolicy,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) || errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load default gateway: %w", err)
	}
	return &gateway, nil
}

func (s Service) enforceTunnelEgress(ctx context.Context, userID string, gateway *gatewaySnapshot, connectionID, targetHost string, targetPort int, protocol, ipAddress string) error {
	if gateway == nil {
		return nil
	}
	decision := tunnelegress.Authorize(ctx, tunnelegress.Check{
		Policy:       gateway.EgressPolicy,
		Protocol:     protocol,
		TargetHost:   targetHost,
		TargetPort:   targetPort,
		UserID:       userID,
		GatewayID:    gateway.ID,
		ConnectionID: connectionID,
		IPAddress:    ipAddress,
	})
	if decision.Allowed {
		return nil
	}
	tunnelegress.InsertDeniedAudit(ctx, s.DB, tunnelegress.DeniedAudit{
		UserID:       userID,
		GatewayID:    gateway.ID,
		ConnectionID: connectionID,
		Protocol:     protocol,
		TargetHost:   targetHost,
		TargetPort:   targetPort,
		Reason:       decision.Reason,
		IPAddress:    ipAddress,
	})
	return &requestError{status: http.StatusForbidden, message: "Tunnel egress denied: " + decision.Reason}
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
