package gateways

import (
	"database/sql"
	"fmt"
	"strings"
	"time"
)

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
