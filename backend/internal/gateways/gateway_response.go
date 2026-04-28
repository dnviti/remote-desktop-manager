package gateways

import "strings"

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
