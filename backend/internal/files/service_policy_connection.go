package files

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

type resolvedTransferRetentionPolicy struct {
	RetainSuccessfulUploads bool `json:"retainSuccessfulUploads"`
	MaxUploadSizeBytes      int64 `json:"maxUploadSizeBytes"`
}

func (s Service) resolveRDPPolicy(ctx context.Context, claims authn.Claims, connectionID string) (sshsessions.ResolvedConnection, resolvedFilePolicy, error) {
	resolved, err := s.ConnectionResolver.ResolveConnection(ctx, claims.UserID, claims.TenantID, connectionID, sshsessions.ResolveConnectionOptions{
		ExpectedType: "RDP",
	})
	if err != nil {
		return sshsessions.ResolvedConnection{}, resolvedFilePolicy{}, err
	}
	policy, err := s.resolvePolicy(ctx, claims.TenantID, resolved.Connection.DLPPolicy)
	if err != nil {
		return sshsessions.ResolvedConnection{}, resolvedFilePolicy{}, err
	}
	transferPolicy := resolveTransferRetentionPolicy(resolved.Connection.TransferRetentionPolicy)
	policy.RetainSuccessfulUploads = transferPolicy.RetainSuccessfulUploads
	policy.FileUploadMax = &transferPolicy.MaxUploadSizeBytes
	return resolved, policy, nil
}

func (s Service) resolveSSHPolicy(ctx context.Context, claims authn.Claims, connectionID string, opts sshsessions.ResolveConnectionOptions) (sshsessions.ResolvedFileTransferTarget, resolvedFilePolicy, error) {
	target, err := s.ConnectionResolver.ResolveFileTransferTarget(ctx, claims.UserID, claims.TenantID, connectionID, opts)
	if err != nil {
		return sshsessions.ResolvedFileTransferTarget{}, resolvedFilePolicy{}, err
	}
	policy, err := s.resolvePolicy(ctx, claims.TenantID, target.Connection.DLPPolicy)
	if err != nil {
		return sshsessions.ResolvedFileTransferTarget{}, resolvedFilePolicy{}, err
	}
	transferPolicy := resolveTransferRetentionPolicy(target.Connection.TransferRetentionPolicy)
	policy.RetainSuccessfulUploads = transferPolicy.RetainSuccessfulUploads
	policy.FileUploadMax = &transferPolicy.MaxUploadSizeBytes
	return target, policy, nil
}

func (s Service) resolvePolicy(ctx context.Context, tenantID string, connectionDLP json.RawMessage) (resolvedFilePolicy, error) {
	tenantPolicy, err := s.loadTenantPolicy(ctx, tenantID)
	if err != nil {
		return resolvedFilePolicy{}, err
	}

	var conn dlpPolicy
	if len(connectionDLP) > 0 && string(connectionDLP) != "null" {
		if err := json.Unmarshal(connectionDLP, &conn); err != nil {
			return resolvedFilePolicy{}, fmt.Errorf("parse connection file dlp: %w", err)
		}
	}

	return resolvedFilePolicy{
		DisableDownload: tenantPolicy.DLPDisableDownload || conn.DisableDownload,
		DisableUpload:   tenantPolicy.DLPDisableUpload || conn.DisableUpload,
		FileUploadMax:   tenantPolicy.FileUploadMaxBytes,
		UserDriveQuota:  tenantPolicy.UserDriveQuota,
	}, nil
}

func resolveTransferRetentionPolicy(raw json.RawMessage) resolvedTransferRetentionPolicy {
	resolved := connections.ResolveTransferRetentionPolicy(raw)
	var policy resolvedTransferRetentionPolicy
	if err := json.Unmarshal(resolved, &policy); err != nil {
		return resolvedTransferRetentionPolicy{}
	}
	return policy
}

func managedDownloadPolicyError(policy resolvedFilePolicy) error {
	if !policy.DisableDownload {
		return nil
	}
	return &requestError{status: http.StatusForbidden, message: "File download is disabled by organization policy"}
}
