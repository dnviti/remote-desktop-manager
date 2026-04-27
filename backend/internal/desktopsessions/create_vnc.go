package desktopsessions

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connectionaccess"
)

func (s Service) createVNCSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string, connection desktopConnectionSnapshot, policy desktopPolicySnapshot, route desktopRoute) (createResponse, error) {
	connectionSettings, err := parseJSONPatch[vncSettingsPatch](connection.VNCSettings)
	if err != nil {
		return createResponse{}, fmt.Errorf("parse connection VNC settings: %w", err)
	}

	var enforcedVNC *vncSettingsPatch
	if policy.EnforcedSettings != nil {
		enforcedVNC = policy.EnforcedSettings.VNC
	}
	mergedSettings := mergeVNCSettings(connectionSettings, enforcedVNC)

	password := ""
	if payload.Username != "" && payload.Password != "" {
		password = payload.Password
	} else {
		resolution, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connection.ID, connectionaccess.ResolveConnectionOptions{
			ExpectedType: "VNC",
		})
		if err != nil {
			return createResponse{}, err
		}
		if strings.TrimSpace(resolution.Credentials.Password) == "" && strings.TrimSpace(resolution.Credentials.PrivateKey) != "" {
			return createResponse{}, &requestError{status: http.StatusBadRequest, message: "SSH key authentication is not supported for VNC connections"}
		}
		password = strings.TrimSpace(resolution.Credentials.Password)
	}
	if password == "" {
		return createResponse{}, &requestError{status: http.StatusNotFound, message: "Connection not found or credentials unavailable"}
	}

	var (
		recordingID     string
		recordingConfig *recordingSettings
	)
	if s.RecordingEnabled && policy.RecordingEnabled {
		recordingID, recordingConfig, err = s.startRecording(ctx, claims.UserID, connection.ID, "VNC", route.RecordingGatewayDir, nil, nil)
		if err != nil {
			recordingID = ""
			recordingConfig = nil
		}
	}

	tokenSettings := buildVNCGuacamoleSettings(
		connection.Host,
		connection.Port,
		password,
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
		TenantID:     claims.TenantID,
		UserID:       claims.UserID,
		ConnectionID: connection.ID,
		GatewayID:    route.GatewayID,
		InstanceID:   route.InstanceID,
		Protocol:     "VNC",
		IPAddress:    ipAddress,
		SessionMetadata: map[string]any{
			"host": connection.Host,
			"port": connection.Port,
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
		Token:       grant.Token,
		SessionID:   grant.SessionID,
		RecordingID: firstNonEmpty(grant.RecordingID, recordingID),
		DLPPolicy:   policy.DLPPolicy,
	}, nil
}
