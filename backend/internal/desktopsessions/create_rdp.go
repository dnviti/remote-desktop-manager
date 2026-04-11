package desktopsessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/files"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func (s Service) createRDPSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string, connection desktopConnectionSnapshot, policy desktopPolicySnapshot, route desktopRoute) (createResponse, error) {
	userDefaults, err := s.loadUserRDPDefaults(ctx, claims.UserID)
	if err != nil {
		return createResponse{}, err
	}
	connectionSettings, err := parseJSONPatch[rdpSettingsPatch](connection.RDPSettings)
	if err != nil {
		return createResponse{}, fmt.Errorf("parse connection RDP settings: %w", err)
	}

	var enforcedRDP *rdpSettingsPatch
	if policy.EnforcedSettings != nil {
		enforcedRDP = policy.EnforcedSettings.RDP
	}
	mergedSettings := mergeRDPSettings(userDefaults, connectionSettings, enforcedRDP)

	resolution, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connection.ID, sshsessions.ResolveConnectionOptions{
		ExpectedType:     "RDP",
		OverrideUsername: payload.Username,
		OverridePassword: payload.Password,
		OverrideDomain:   payload.Domain,
		CredentialMode:   payload.CredentialMode,
	})
	if err != nil {
		return createResponse{}, err
	}
	if strings.TrimSpace(resolution.Credentials.Password) == "" && strings.TrimSpace(resolution.Credentials.PrivateKey) != "" {
		return createResponse{}, &requestError{status: http.StatusBadRequest, message: "SSH key authentication is not supported for RDP connections"}
	}
	if strings.TrimSpace(resolution.Credentials.Username) == "" || strings.TrimSpace(resolution.Credentials.Password) == "" {
		return createResponse{}, &requestError{status: http.StatusNotFound, message: "Connection not found or credentials unavailable"}
	}

	var (
		recordingID     string
		recordingConfig *recordingSettings
		recordingWidth  *int
		recordingHeight *int
	)
	if s.RecordingEnabled && policy.RecordingEnabled {
		mergedSettings = prepareRecordedRDPSettings(mergedSettings)
		recordingWidth = cloneIntPtr(mergedSettings.Width)
		recordingHeight = cloneIntPtr(mergedSettings.Height)
		recordingID, recordingConfig, err = s.startRecording(ctx, claims.UserID, connection.ID, "RDP", route.RecordingGatewayDir, recordingWidth, recordingHeight)
		if err != nil {
			recordingID = ""
			recordingConfig = nil
		}
	}

	drivePath := ""
	if connection.EnableDrive {
		drivePath = files.DrivePath(s.DriveBasePath, claims.UserID, connection.ID)
	}
	tokenSettings := buildRDPGuacamoleSettings(
		connection.Host,
		connection.Port,
		strings.TrimSpace(resolution.Credentials.Username),
		strings.TrimSpace(resolution.Credentials.Password),
		strings.TrimSpace(resolution.Credentials.Domain),
		connection.EnableDrive,
		drivePath,
		mergedSettings,
		policy.DLPPolicy,
		recordingConfig,
	)

	tokenMetadata := map[string]any{
		"userId":       claims.UserID,
		"connectionId": connection.ID,
	}
	if ipAddress != "" {
		tokenMetadata["ipAddress"] = ipAddress
	}
	if recordingID != "" {
		tokenMetadata["recordingId"] = recordingID
	}

	grant, err := s.IssueGrant(ctx, GrantIssueRequest{
		UserID:       claims.UserID,
		ConnectionID: connection.ID,
		GatewayID:    route.GatewayID,
		InstanceID:   route.InstanceID,
		Protocol:     "RDP",
		IPAddress:    ipAddress,
		SessionMetadata: map[string]any{
			"host":             connection.Host,
			"port":             connection.Port,
			"credentialSource": resolution.Credentials.CredentialSource,
		},
		RoutingDecision: route.RoutingDecision,
		RecordingID:     recordingID,
		Token: DesktopTokenRequest{
			GuacdHost: route.GuacdHost,
			GuacdPort: route.GuacdPort,
			Settings:  tokenSettings,
			Metadata:  tokenMetadata,
		},
	})
	if err != nil {
		return createResponse{}, err
	}

	return createResponse{
		Token:            grant.Token,
		EnableDrive:      connection.EnableDrive,
		SessionID:        grant.SessionID,
		RecordingID:      firstNonEmpty(grant.RecordingID, recordingID),
		DLPPolicy:        policy.DLPPolicy,
		ResolvedUsername: strings.TrimSpace(resolution.Credentials.Username),
		ResolvedDomain:   strings.TrimSpace(resolution.Credentials.Domain),
	}, nil
}

func (s Service) loadDesktopPolicy(ctx context.Context, tenantID string, connectionDLP json.RawMessage) (desktopPolicySnapshot, error) {
	var (
		tenantDLP resolvedDLP
		enforced  []byte
		recording = true
	)

	if strings.TrimSpace(tenantID) != "" {
		if err := s.DB.QueryRow(ctx, `
SELECT "dlpDisableCopy", "dlpDisablePaste", "dlpDisableDownload", "dlpDisableUpload", "enforcedConnectionSettings", "recordingEnabled"
FROM "Tenant"
WHERE id = $1
`, tenantID).Scan(
			&tenantDLP.DisableCopy,
			&tenantDLP.DisablePaste,
			&tenantDLP.DisableDownload,
			&tenantDLP.DisableUpload,
			&enforced,
			&recording,
		); err != nil {
			return desktopPolicySnapshot{}, fmt.Errorf("load tenant desktop policy: %w", err)
		}
	}

	connectionPolicy, err := parseJSONPatch[dlpPolicy](connectionDLP)
	if err != nil {
		return desktopPolicySnapshot{}, fmt.Errorf("parse connection DLP policy: %w", err)
	}
	enforcedSettings, err := parseJSONPatch[enforcedConnectionSettings](json.RawMessage(enforced))
	if err != nil {
		return desktopPolicySnapshot{}, fmt.Errorf("parse tenant enforced connection settings: %w", err)
	}

	return desktopPolicySnapshot{
		DLPPolicy:        mergeDLPPolicy(tenantDLP, connectionPolicy),
		RecordingEnabled: recording,
		EnforcedSettings: enforcedSettings,
	}, nil
}

func (s Service) loadUserRDPDefaults(ctx context.Context, userID string) (*rdpSettingsPatch, error) {
	var raw []byte
	if err := s.DB.QueryRow(ctx, `SELECT "rdpDefaults" FROM "User" WHERE id = $1`, userID).Scan(&raw); err != nil {
		return nil, fmt.Errorf("load user RDP defaults: %w", err)
	}
	settings, err := parseJSONPatch[rdpSettingsPatch](json.RawMessage(raw))
	if err != nil {
		return nil, fmt.Errorf("parse user RDP defaults: %w", err)
	}
	return settings, nil
}
