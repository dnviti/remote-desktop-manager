package dbsessions

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
)

func (s Service) resolveDatabaseRoute(ctx context.Context, tenantID string, explicitGatewayID *string, targetHost string, targetPort int, userID, connectionID, ipAddress string) (databaseRoute, error) {
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

	// Managed DB proxy groups can select a specific healthy instance before optional tunnel wrapping.
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
		if err := s.enforceTunnelEgress(ctx, userID, gateway, connectionID, targetHost, targetPort, "DATABASE", ipAddress); err != nil {
			return databaseRoute{}, err
		}
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
SELECT id, "tenantId", type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN'), COALESCE("egressPolicy", '{"rules":[]}'::jsonb)
FROM "Gateway"
WHERE id = $1
`, gatewayID).Scan(
		&gateway.ID,
		&gateway.TenantID,
		&gateway.Type,
		&gateway.Host,
		&gateway.Port,
		&gateway.IsManaged,
		&gateway.DeploymentMode,
		&gateway.TunnelEnabled,
		&gateway.LBStrategy,
		&gateway.EgressPolicy,
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
SELECT id, "tenantId", type::text, host, port, "isManaged", "deploymentMode"::text, "tunnelEnabled", COALESCE("lbStrategy"::text, 'ROUND_ROBIN'), COALESCE("egressPolicy", '{"rules":[]}'::jsonb)
FROM "Gateway"
WHERE "tenantId" = $1
  AND type = 'DB_PROXY'::"GatewayType"
  AND "isDefault" = true
LIMIT 1
`, tenantID).Scan(
		&gateway.ID,
		&gateway.TenantID,
		&gateway.Type,
		&gateway.Host,
		&gateway.Port,
		&gateway.IsManaged,
		&gateway.DeploymentMode,
		&gateway.TunnelEnabled,
		&gateway.LBStrategy,
		&gateway.EgressPolicy,
	); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
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
	teamIDs, err := tunnelegress.LoadActiveTeamIDs(ctx, s.DB, gateway.TenantID, userID)
	if err != nil {
		return err
	}
	decision := tunnelegress.Authorize(ctx, tunnelegress.Check{
		Policy:       gateway.EgressPolicy,
		Protocol:     protocol,
		TargetHost:   targetHost,
		TargetPort:   targetPort,
		UserID:       userID,
		TeamIDs:      teamIDs,
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
		RuleIndex:    decision.RuleIndex,
		RuleAction:   decision.RuleAction,
		Rule:         decision.Rule,
		IPAddress:    ipAddress,
	})
	return &requestError{status: http.StatusForbidden, message: "Tunnel egress denied: " + decision.Reason}
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
