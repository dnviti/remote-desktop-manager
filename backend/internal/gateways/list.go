package gateways

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"strings"
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

type rowScanner interface {
	Scan(dest ...any) error
}

func scanGateway(row rowScanner) (gatewayRecord, error) {
	var item gatewayRecord
	var description, encryptedUsername, usernameIV, usernameTag sql.NullString
	var encryptedPassword, passwordIV, passwordTag, encryptedSSHKey, sshKeyIV, sshKeyTag sql.NullString
	var encryptedTunnelToken, tunnelTokenIV, tunnelTokenTag sql.NullString
	var tunnelClientCert, tunnelClientKey, tunnelClientKeyIV, tunnelClientKeyTag sql.NullString
	var templateID, lastError sql.NullString
	var apiPort, lastLatency sql.NullInt32
	var lastCheckedAt, lastScaleAction, tunnelConnectedAt, tunnelClientCertExp sql.NullTime
	var egressPolicy []byte
	var hasSSHKey bool
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Type,
		&item.Host,
		&item.Port,
		&item.DeploymentMode,
		&description,
		&item.IsDefault,
		&hasSSHKey,
		&encryptedUsername,
		&usernameIV,
		&usernameTag,
		&encryptedPassword,
		&passwordIV,
		&passwordTag,
		&encryptedSSHKey,
		&sshKeyIV,
		&sshKeyTag,
		&apiPort,
		&item.InactivityTimeoutSeconds,
		&item.TenantID,
		&item.CreatedByID,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.MonitoringEnabled,
		&item.MonitorIntervalMS,
		&item.LastHealthStatus,
		&lastCheckedAt,
		&lastLatency,
		&lastError,
		&item.IsManaged,
		&item.PublishPorts,
		&item.LBStrategy,
		&item.DesiredReplicas,
		&item.AutoScale,
		&item.MinReplicas,
		&item.MaxReplicas,
		&item.SessionsPerInstance,
		&item.ScaleDownCooldownSeconds,
		&lastScaleAction,
		&templateID,
		&item.TunnelEnabled,
		&encryptedTunnelToken,
		&tunnelTokenIV,
		&tunnelTokenTag,
		&tunnelConnectedAt,
		&tunnelClientCert,
		&tunnelClientKey,
		&tunnelClientKeyIV,
		&tunnelClientKeyTag,
		&tunnelClientCertExp,
		&egressPolicy,
		&item.TotalInstances,
		&item.HealthyInstances,
		&item.RunningInstances,
		&item.TunnelConnected,
	); err != nil {
		return gatewayRecord{}, fmt.Errorf("scan gateway: %w", err)
	}
	item.Description = nullStringPtr(description)
	item.EncryptedUsername = nullStringPtr(encryptedUsername)
	item.UsernameIV = nullStringPtr(usernameIV)
	item.UsernameTag = nullStringPtr(usernameTag)
	item.EncryptedPassword = nullStringPtr(encryptedPassword)
	item.PasswordIV = nullStringPtr(passwordIV)
	item.PasswordTag = nullStringPtr(passwordTag)
	item.EncryptedSSHKey = nullStringPtr(encryptedSSHKey)
	item.SSHKeyIV = nullStringPtr(sshKeyIV)
	item.SSHKeyTag = nullStringPtr(sshKeyTag)
	item.APIPort = nullIntPtr(apiPort)
	item.LastCheckedAt = nullTimePtr(lastCheckedAt)
	item.LastLatencyMS = nullIntPtr(lastLatency)
	item.LastError = nullStringPtr(lastError)
	item.LastScaleAction = nullTimePtr(lastScaleAction)
	item.TemplateID = nullStringPtr(templateID)
	item.TunnelConnectedAt = nullTimePtr(tunnelConnectedAt)
	item.EncryptedTunnelToken = nullStringPtr(encryptedTunnelToken)
	item.TunnelTokenIV = nullStringPtr(tunnelTokenIV)
	item.TunnelTokenTag = nullStringPtr(tunnelTokenTag)
	item.TunnelClientCert = nullStringPtr(tunnelClientCert)
	item.TunnelClientKey = nullStringPtr(tunnelClientKey)
	item.TunnelClientKeyIV = nullStringPtr(tunnelClientKeyIV)
	item.TunnelClientKeyTag = nullStringPtr(tunnelClientKeyTag)
	item.TunnelClientCertExp = nullTimePtr(tunnelClientCertExp)
	item.EgressPolicy = normalizeGatewayEgressPolicyForResponse(egressPolicy)
	if strings.TrimSpace(item.DeploymentMode) == "" {
		if item.IsManaged {
			item.DeploymentMode = "MANAGED_GROUP"
		} else {
			item.DeploymentMode = "SINGLE_INSTANCE"
		}
	}
	item.IsManaged = deploymentModeIsGroup(item.DeploymentMode)
	if !hasSSHKey {
		item.EncryptedSSHKey = nil
	}
	return item, nil
}

func gatewayRecordToResponse(item gatewayRecord) gatewayResponse {
	return gatewayRecordToResponseWithStatus(item, tunnelStatusSnapshot{}, false, false)
}

func gatewayRecordToResponseWithStatus(
	item gatewayRecord,
	tunnelStatus tunnelStatusSnapshot,
	hasTunnelStatus bool,
	tunnelBrokerAvailable bool,
) gatewayResponse {
	deploymentMode := item.DeploymentMode
	if strings.TrimSpace(deploymentMode) == "" {
		if item.IsManaged {
			deploymentMode = "MANAGED_GROUP"
		} else {
			deploymentMode = "SINGLE_INSTANCE"
		}
	}
	operationalStatus, operationalReason, tunnelConnected, tunnelConnectedAt := deriveGatewayOperationalState(
		item,
		tunnelStatus,
		hasTunnelStatus,
		tunnelBrokerAvailable,
	)
	reportedHealth := deriveGatewayReportedHealth(
		item,
		tunnelStatus,
		hasTunnelStatus,
		tunnelBrokerAvailable,
		operationalStatus,
		operationalReason,
		tunnelConnectedAt,
	)
	totalInstances, healthyInstances, runningInstances := deriveGatewayReportedInstanceCounts(
		item,
		tunnelStatus,
		hasTunnelStatus,
		tunnelBrokerAvailable,
	)
	return gatewayResponse{
		ID:                       item.ID,
		Name:                     item.Name,
		Type:                     item.Type,
		Host:                     item.Host,
		Port:                     item.Port,
		DeploymentMode:           deploymentMode,
		Description:              item.Description,
		IsDefault:                item.IsDefault,
		HasSSHKey:                item.EncryptedSSHKey != nil,
		APIPort:                  item.APIPort,
		InactivityTimeoutSeconds: item.InactivityTimeoutSeconds,
		TenantID:                 item.TenantID,
		CreatedByID:              item.CreatedByID,
		CreatedAt:                item.CreatedAt,
		UpdatedAt:                item.UpdatedAt,
		MonitoringEnabled:        item.MonitoringEnabled,
		MonitorIntervalMS:        item.MonitorIntervalMS,
		LastHealthStatus:         reportedHealth.Status,
		LastCheckedAt:            reportedHealth.CheckedAt,
		LastLatencyMS:            reportedHealth.LatencyMS,
		LastError:                reportedHealth.Error,
		IsManaged:                deploymentModeIsGroup(deploymentMode),
		PublishPorts:             item.PublishPorts,
		LBStrategy:               item.LBStrategy,
		DesiredReplicas:          item.DesiredReplicas,
		AutoScale:                item.AutoScale,
		MinReplicas:              item.MinReplicas,
		MaxReplicas:              item.MaxReplicas,
		SessionsPerInstance:      item.SessionsPerInstance,
		ScaleDownCooldownSeconds: item.ScaleDownCooldownSeconds,
		LastScaleAction:          item.LastScaleAction,
		TemplateID:               item.TemplateID,
		TotalInstances:           totalInstances,
		HealthyInstances:         healthyInstances,
		RunningInstances:         runningInstances,
		TunnelEnabled:            item.TunnelEnabled,
		TunnelConnected:          tunnelConnected,
		TunnelConnectedAt:        tunnelConnectedAt,
		TunnelClientCertExp:      item.TunnelClientCertExp,
		EgressPolicy:             normalizeGatewayEgressPolicyForResponse(item.EgressPolicy),
		OperationalStatus:        operationalStatus,
		OperationalReason:        operationalReason,
	}
}

func nullStringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	result := value.String
	return &result
}

func nullIntPtr(value sql.NullInt32) *int {
	if !value.Valid {
		return nil
	}
	result := int(value.Int32)
	return &result
}

func nullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	result := value.Time
	return &result
}
