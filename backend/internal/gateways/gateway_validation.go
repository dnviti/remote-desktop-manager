package gateways

import (
	"net/http"
	"strings"
)

func validateCreatePayload(input createPayload) error {
	if strings.TrimSpace(input.Name) == "" {
		return &requestError{status: http.StatusBadRequest, message: "name is required"}
	}
	gatewayType := strings.ToUpper(strings.TrimSpace(input.Type))
	switch gatewayType {
	case "GUACD", "SSH_BASTION", "MANAGED_SSH", "DB_PROXY":
	default:
		return &requestError{status: http.StatusBadRequest, message: "type must be one of GUACD, SSH_BASTION, MANAGED_SSH, DB_PROXY"}
	}
	deploymentMode, err := normalizeDeploymentMode(input.DeploymentMode, gatewayType, input.Host)
	if err != nil {
		return err
	}
	if !deploymentModeIsGroup(deploymentMode) && strings.TrimSpace(input.Host) == "" {
		return &requestError{status: http.StatusBadRequest, message: "host is required"}
	}
	if input.Port < 1 || input.Port > 65535 {
		return &requestError{status: http.StatusBadRequest, message: "port must be between 1 and 65535"}
	}
	if input.APIPort != nil && (*input.APIPort < 1 || *input.APIPort > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "apiPort must be between 1 and 65535"}
	}
	if input.MonitorIntervalMS != nil && (*input.MonitorIntervalMS < 1000 || *input.MonitorIntervalMS > 3600000) {
		return &requestError{status: http.StatusBadRequest, message: "monitorIntervalMs must be between 1000 and 3600000"}
	}
	if input.InactivityTimeoutSeconds != nil && (*input.InactivityTimeoutSeconds < 60 || *input.InactivityTimeoutSeconds > 86400) {
		return &requestError{status: http.StatusBadRequest, message: "inactivityTimeoutSeconds must be between 60 and 86400"}
	}
	if input.LBStrategy != nil {
		switch strings.ToUpper(strings.TrimSpace(*input.LBStrategy)) {
		case "ROUND_ROBIN", "LEAST_CONNECTIONS":
		default:
			return &requestError{status: http.StatusBadRequest, message: "lbStrategy must be ROUND_ROBIN or LEAST_CONNECTIONS"}
		}
	}
	return nil
}

func validateUpdatePayload(gatewayType string, input updatePayload) error {
	if input.DeploymentMode.Present && input.DeploymentMode.Value != nil {
		if _, err := normalizeDeploymentMode(input.DeploymentMode.Value, gatewayType, ""); err != nil {
			return err
		}
	}
	if input.Port.Present && input.Port.Value != nil && (*input.Port.Value < 1 || *input.Port.Value > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "port must be between 1 and 65535"}
	}
	if input.APIPort.Present && input.APIPort.Value != nil && (*input.APIPort.Value < 1 || *input.APIPort.Value > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "apiPort must be between 1 and 65535"}
	}
	if input.MonitorIntervalMS.Present && input.MonitorIntervalMS.Value != nil && (*input.MonitorIntervalMS.Value < 1000 || *input.MonitorIntervalMS.Value > 3600000) {
		return &requestError{status: http.StatusBadRequest, message: "monitorIntervalMs must be between 1000 and 3600000"}
	}
	if input.InactivityTimeoutSeconds.Present && input.InactivityTimeoutSeconds.Value != nil && (*input.InactivityTimeoutSeconds.Value < 60 || *input.InactivityTimeoutSeconds.Value > 86400) {
		return &requestError{status: http.StatusBadRequest, message: "inactivityTimeoutSeconds must be between 60 and 86400"}
	}
	if input.LBStrategy.Present && input.LBStrategy.Value != nil {
		switch strings.ToUpper(strings.TrimSpace(*input.LBStrategy.Value)) {
		case "ROUND_ROBIN", "LEAST_CONNECTIONS":
		default:
			return &requestError{status: http.StatusBadRequest, message: "lbStrategy must be ROUND_ROBIN or LEAST_CONNECTIONS"}
		}
	}
	if gatewayType != "SSH_BASTION" && (input.Username.Present || input.Password.Present || input.SSHPrivateKey.Present) {
		return &requestError{status: http.StatusBadRequest, message: "Credentials can only be set for SSH_BASTION gateways"}
	}
	return nil
}

func changedGatewayFields(input updatePayload) []string {
	fields := make([]string, 0)
	if input.Name.Present {
		fields = append(fields, "name")
	}
	if input.Host.Present {
		fields = append(fields, "host")
	}
	if input.Port.Present {
		fields = append(fields, "port")
	}
	if input.DeploymentMode.Present {
		fields = append(fields, "deploymentMode")
	}
	if input.Description.Present {
		fields = append(fields, "description")
	}
	if input.IsDefault.Present {
		fields = append(fields, "isDefault")
	}
	if input.Username.Present {
		fields = append(fields, "username")
	}
	if input.Password.Present {
		fields = append(fields, "password")
	}
	if input.SSHPrivateKey.Present {
		fields = append(fields, "sshPrivateKey")
	}
	if input.APIPort.Present {
		fields = append(fields, "apiPort")
	}
	if input.PublishPorts.Present {
		fields = append(fields, "publishPorts")
	}
	if input.LBStrategy.Present {
		fields = append(fields, "lbStrategy")
	}
	if input.MonitoringEnabled.Present {
		fields = append(fields, "monitoringEnabled")
	}
	if input.MonitorIntervalMS.Present {
		fields = append(fields, "monitorIntervalMs")
	}
	if input.InactivityTimeoutSeconds.Present {
		fields = append(fields, "inactivityTimeoutSeconds")
	}
	if input.EgressPolicy.Present {
		fields = append(fields, "egressPolicy")
	}
	return fields
}

func normalizeDeploymentMode(raw *string, gatewayType, host string) (string, error) {
	mode := ""
	if raw != nil {
		mode = strings.ToUpper(strings.TrimSpace(*raw))
	}
	if mode == "" {
		if strings.ToUpper(strings.TrimSpace(gatewayType)) == "SSH_BASTION" || strings.TrimSpace(host) != "" {
			mode = "SINGLE_INSTANCE"
		} else {
			mode = "MANAGED_GROUP"
		}
	}
	switch mode {
	case "SINGLE_INSTANCE", "MANAGED_GROUP":
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "deploymentMode must be SINGLE_INSTANCE or MANAGED_GROUP"}
	}
	gatewayType = strings.ToUpper(strings.TrimSpace(gatewayType))
	if gatewayType == "SSH_BASTION" && mode == "MANAGED_GROUP" {
		return "", &requestError{status: http.StatusBadRequest, message: "SSH_BASTION gateways must use SINGLE_INSTANCE deployment mode"}
	}
	if mode == "MANAGED_GROUP" && !isManagedLifecycleGatewayType(gatewayType) {
		return "", &requestError{status: http.StatusBadRequest, message: "Only MANAGED_SSH, GUACD, and DB_PROXY gateways can use MANAGED_GROUP deployment mode"}
	}
	return mode, nil
}

func deploymentModeIsGroup(mode string) bool {
	return strings.EqualFold(strings.TrimSpace(mode), "MANAGED_GROUP")
}

func normalizeGatewayHostForMode(mode, host string) string {
	if deploymentModeIsGroup(mode) {
		return ""
	}
	return strings.TrimSpace(host)
}
