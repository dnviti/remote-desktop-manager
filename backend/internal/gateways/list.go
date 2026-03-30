package gateways

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

const gatewaySelect = `
SELECT
	g.id,
	g.name,
	g.type::text,
	g.host,
	g.port,
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
	g."tunnelConnectedAt",
	g."tunnelClientCertExp",
	COALESCE(total_instances.count, 0) AS "totalInstances",
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

	result := make([]gatewayResponse, 0)
	for rows.Next() {
		record, err := scanGateway(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, gatewayRecordToResponse(record))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gateways: %w", err)
	}
	return result, nil
}

func (s Service) loadGateway(ctx context.Context, tenantID, gatewayID string) (gatewayRecord, error) {
	row := s.DB.QueryRow(ctx, gatewaySelect+`
WHERE g."tenantId" = $1 AND g.id = $2
`, tenantID, gatewayID)
	record, err := scanGateway(row)
	if err != nil {
		return gatewayRecord{}, err
	}
	return record, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanGateway(row rowScanner) (gatewayRecord, error) {
	var item gatewayRecord
	var description, encryptedUsername, usernameIV, usernameTag sql.NullString
	var encryptedPassword, passwordIV, passwordTag, encryptedSSHKey, sshKeyIV, sshKeyTag sql.NullString
	var templateID, lastError sql.NullString
	var apiPort, lastLatency sql.NullInt32
	var lastCheckedAt, lastScaleAction, tunnelConnectedAt, tunnelClientCertExp sql.NullTime
	var hasSSHKey bool
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Type,
		&item.Host,
		&item.Port,
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
		&tunnelConnectedAt,
		&tunnelClientCertExp,
		&item.TotalInstances,
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
	item.TunnelClientCertExp = nullTimePtr(tunnelClientCertExp)
	if !hasSSHKey {
		item.EncryptedSSHKey = nil
	}
	return item, nil
}

func gatewayRecordToResponse(item gatewayRecord) gatewayResponse {
	return gatewayResponse{
		ID:                       item.ID,
		Name:                     item.Name,
		Type:                     item.Type,
		Host:                     item.Host,
		Port:                     item.Port,
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
		LastHealthStatus:         item.LastHealthStatus,
		LastCheckedAt:            item.LastCheckedAt,
		LastLatencyMS:            item.LastLatencyMS,
		LastError:                item.LastError,
		IsManaged:                item.IsManaged,
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
		TotalInstances:           item.TotalInstances,
		RunningInstances:         item.RunningInstances,
		TunnelEnabled:            item.TunnelEnabled,
		TunnelConnected:          item.TunnelConnected,
		TunnelConnectedAt:        item.TunnelConnectedAt,
		TunnelClientCertExp:      item.TunnelClientCertExp,
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
