package sshsessions

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessionrecording"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

func (s Service) StartSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string) (coreResult, error) {
	if s.DB == nil || s.SessionStore == nil {
		return coreResult{}, fmt.Errorf("database session dependencies are unavailable")
	}

	payload.ConnectionID = strings.TrimSpace(payload.ConnectionID)
	payload.Username = strings.TrimSpace(payload.Username)
	payload.CredentialMode = normalizeCredentialMode(payload.CredentialMode)
	if payload.ConnectionID == "" {
		return coreResult{}, &requestError{status: http.StatusBadRequest, message: "connectionId is required"}
	}
	if payload.CredentialMode != "domain" {
		if (payload.Username == "") != (payload.Password == "") {
			return coreResult{}, &requestError{status: http.StatusBadRequest, message: "Both username and password must be provided together"}
		}
	}

	if claims.TenantID != "" {
		membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
		if err != nil {
			return coreResult{}, fmt.Errorf("resolve tenant membership: %w", err)
		}
		if membership == nil || !membership.Permissions[tenantauth.CanConnect] {
			return coreResult{}, &requestError{status: http.StatusForbidden, message: "Not allowed to start sessions in this tenant"}
		}
	}

	allowed, err := s.checkLateralMovement(ctx, claims.UserID, payload.ConnectionID, ipAddress)
	if err != nil {
		return coreResult{}, err
	}
	if !allowed {
		return coreResult{}, &requestError{
			status:  http.StatusForbidden,
			message: "Session denied: anomalous lateral movement detected. Your account has been temporarily suspended.",
		}
	}

	access, err := s.loadAccess(ctx, claims.UserID, claims.TenantID, payload.ConnectionID)
	if err != nil {
		return coreResult{}, err
	}
	if !strings.EqualFold(access.Connection.Type, "SSH") {
		return coreResult{}, &requestError{status: http.StatusBadRequest, message: "Not an SSH connection"}
	}

	policies, err := s.loadPolicySnapshot(ctx, claims.TenantID, access.Connection.DLPPolicy)
	if err != nil {
		return coreResult{}, err
	}

	credentials, err := s.resolveCredentials(ctx, claims.UserID, claims.TenantID, payload, access)
	if err != nil {
		return coreResult{}, err
	}

	bastion, gatewayID, instanceID, err := s.resolveBastion(ctx, claims, access)
	if err != nil {
		return coreResult{}, err
	}

	recordingRef, err := s.maybeStartSessionRecording(ctx, claims.TenantID, claims.UserID, access.Connection.ID, "SSH", recordingGatewayDir(gatewayID, instanceID))
	if err != nil {
		return coreResult{}, err
	}

	return s.startResolvedSSHSession(ctx, claims, access, credentials, ipAddress, gatewayID, instanceID, bastion, policies, recordingRef)
}

func (s Service) startResolvedSSHSession(ctx context.Context, claims authn.Claims, access connectionAccess, credentials resolvedCredentials, ipAddress, gatewayID, instanceID string, bastion map[string]any, policies policySnapshot, recordingRef *sessionrecording.Reference) (coreResult, error) {
	sessionMetadata := map[string]any{
		"host":             access.Connection.Host,
		"port":             access.Connection.Port,
		"credentialSource": credentials.CredentialSource,
		"transport":        "terminal-broker",
	}
	if recordingRef != nil {
		sessionMetadata["recording"] = recordingMetadata(*recordingRef)
	}

	sessionID, err := s.SessionStore.StartSession(ctx, sessions.StartSessionParams{
		TenantID:     claims.TenantID,
		UserID:       claims.UserID,
		ConnectionID: access.Connection.ID,
		GatewayID:    gatewayID,
		InstanceID:   instanceID,
		Protocol:     "SSH",
		IPAddress:    ipAddress,
		Metadata:     sessionMetadata,
		RecordingID:  recordingID(recordingRef),
	})
	if err != nil {
		if recordingRef != nil {
			_ = s.deleteSessionRecording(ctx, *recordingRef)
		}
		return coreResult{}, fmt.Errorf("start SSH session: %w", err)
	}

	target := map[string]any{
		"host":     access.Connection.Host,
		"port":     access.Connection.Port,
		"username": credentials.Username,
	}
	if credentials.Password != "" {
		target["password"] = credentials.Password
	}
	if credentials.PrivateKey != "" {
		target["privateKey"] = credentials.PrivateKey
	}
	if credentials.Passphrase != "" {
		target["passphrase"] = credentials.Passphrase
	}

	grant := map[string]any{
		"sessionId":    sessionID,
		"connectionId": access.Connection.ID,
		"userId":       claims.UserID,
		"target":       target,
		"terminal": map[string]any{
			"term": "xterm-256color",
			"cols": 80,
			"rows": 24,
		},
		"metadata": map[string]string{
			"credentialSource": credentials.CredentialSource,
		},
	}
	if recordingRef != nil {
		grant["metadata"] = mergeStringMaps(grant["metadata"].(map[string]string), recordingTokenMetadata(*recordingRef))
	}
	if bastion != nil {
		grant["bastion"] = bastion
	}

	issued, err := s.issueTerminalGrant(ctx, grant)
	if err != nil {
		_ = s.SessionStore.EndOwnedSession(ctx, sessionID, claims.UserID, "grant_issue_failed")
		return coreResult{}, err
	}

	return coreResult{
		SessionID:           sessionID,
		Token:               issued.Token,
		ExpiresAt:           issued.ExpiresAt,
		DLPPolicy:           policies.DLPPolicy,
		EnforcedSSHSettings: policies.EnforcedSSHSettings,
	}, nil
}
