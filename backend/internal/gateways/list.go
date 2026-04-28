package gateways

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"time"
)

const gatewaySelect = `
SELECT
	g.id,
	g.name,
	g.type::text,
	g.host,
	g.port,
	g."deploymentMode"::text,
	g.description,
	g."isDefault",
	(g."encryptedSshKey" IS NOT NULL) AS "hasSshKey",
	g."encryptedUsername",
	g."usernameIV",
	g."usernameTag",
	g."encryptedPassword",
	g."passwordIV",
	g."passwordTag",
	g."encryptedSshKey",
	g."sshKeyIV",
	g."sshKeyTag",
	g."apiPort",
	g."inactivityTimeoutSeconds",
	g."tenantId",
	g."createdById",
	g."createdAt",
	g."updatedAt",
	g."monitoringEnabled",
	g."monitorIntervalMs",
	g."lastHealthStatus"::text,
	g."lastCheckedAt",
	g."lastLatencyMs",
	g."lastError",
	g."isManaged",
	g."publishPorts",
	g."lbStrategy"::text,
	g."desiredReplicas",
	g."autoScale",
	g."minReplicas",
	g."maxReplicas",
	g."sessionsPerInstance",
	g."scaleDownCooldownSeconds",
	g."lastScaleAction",
	g."templateId",
	g."tunnelEnabled",
	g."encryptedTunnelToken",
	g."tunnelTokenIV",
	g."tunnelTokenTag",
	g."tunnelConnectedAt",
	g."tunnelClientCert",
	g."tunnelClientKey",
	g."tunnelClientKeyIV",
	g."tunnelClientKeyTag",
	g."tunnelClientCertExp",
	COALESCE(g."egressPolicy", '{"rules":[]}'::jsonb) AS "egressPolicy",
	COALESCE(total_instances.count, 0) AS "totalInstances",
	COALESCE(healthy_instances.count, 0) AS "healthyInstances",
	COALESCE(running_instances.count, 0) AS "runningInstances",
	CASE WHEN g."tunnelEnabled" THEN g."tunnelConnectedAt" IS NOT NULL ELSE false END AS "tunnelConnected"
FROM "Gateway" g
LEFT JOIN LATERAL (
	SELECT COUNT(*)::int AS count
	FROM "ManagedGatewayInstance" m
	WHERE m."gatewayId" = g.id
) total_instances ON true
LEFT JOIN LATERAL (
	SELECT COUNT(*)::int AS count
	FROM "ManagedGatewayInstance" m
	WHERE m."gatewayId" = g.id
	  AND m.status = 'RUNNING'
	  AND COALESCE(m."healthStatus", '') IN ('healthy', 'starting', 'restarting')
) healthy_instances ON true
LEFT JOIN LATERAL (
	SELECT COUNT(*)::int AS count
	FROM "ManagedGatewayInstance" m
	WHERE m."gatewayId" = g.id
	  AND m.status = 'RUNNING'
) running_instances ON true
`

func (s Service) ListGateways(ctx context.Context, tenantID string) ([]gatewayResponse, error) {
	rows, err := s.DB.Query(ctx, gatewaySelect+`
WHERE g."tenantId" = $1
ORDER BY g.type ASC, g.name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list gateways: %w", err)
	}
	defer rows.Close()

	records := make([]gatewayRecord, 0)
	for rows.Next() {
		record, err := scanGateway(rows)
		if err != nil {
			return nil, err
		}
		records = append(records, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gateways: %w", err)
	}

	now := time.Now()
	for i := range records {
		if refreshed, ok := s.refreshGatewayHealthIfNeeded(ctx, records[i], now); ok {
			records[i] = refreshed
		}
	}

	tunnelStatuses := map[string]tunnelStatusSnapshot{}
	tunnelBrokerAvailable := false
	for _, record := range records {
		if record.TunnelEnabled {
			tunnelStatuses, tunnelBrokerAvailable = s.loadTunnelStatusSnapshots(ctx)
			break
		}
	}

	result := make([]gatewayResponse, 0, len(records))
	for _, record := range records {
		snapshot, ok := tunnelStatuses[record.ID]
		result = append(result, gatewayRecordToResponseWithStatus(record, snapshot, ok, tunnelBrokerAvailable))
	}
	return result, nil
}

func (s Service) loadGateway(ctx context.Context, tenantID, gatewayID string) (gatewayRecord, error) {
	row := s.DB.QueryRow(ctx, gatewaySelect+`
WHERE g."tenantId" = $1 AND g.id = $2
	`, tenantID, gatewayID)
	record, err := scanGateway(row)
	if err != nil {
		return gatewayRecord{}, mapLoadGatewayError(err)
	}
	return record, nil
}

func mapLoadGatewayError(err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return &requestError{status: http.StatusNotFound, message: "Gateway not found"}
	}
	return err
}
