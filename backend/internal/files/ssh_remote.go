package files

import (
	"context"
	"errors"
	"io"
	"net/http"
	"os"
	"path"
	"strings"
	"sync"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/sshtransport"
	"github.com/pkg/sftp"
)

type sshRemoteClient interface {
	Getwd() (string, error)
	ReadDir(path string) ([]os.FileInfo, error)
	Mkdir(path string) error
	Stat(path string) (os.FileInfo, error)
	RemoveDirectory(path string) error
	Remove(path string) error
	Rename(oldPath, newPath string) error
	Create(path string) (io.WriteCloser, error)
	Open(path string) (io.ReadCloser, error)
}

type sftpRemoteClient struct {
	client *sftp.Client
}

func (c sftpRemoteClient) Getwd() (string, error) {
	return c.client.Getwd()
}

func (c sftpRemoteClient) ReadDir(path string) ([]os.FileInfo, error) {
	return c.client.ReadDir(path)
}

func (c sftpRemoteClient) Mkdir(path string) error {
	return c.client.Mkdir(path)
}

func (c sftpRemoteClient) Stat(path string) (os.FileInfo, error) {
	return c.client.Stat(path)
}

func (c sftpRemoteClient) RemoveDirectory(path string) error {
	return c.client.RemoveDirectory(path)
}

func (c sftpRemoteClient) Remove(path string) error {
	return c.client.Remove(path)
}

func (c sftpRemoteClient) Rename(oldPath, newPath string) error {
	return c.client.Rename(oldPath, newPath)
}

func (c sftpRemoteClient) Create(path string) (io.WriteCloser, error) {
	return c.client.Create(path)
}

func (c sftpRemoteClient) Open(path string) (io.ReadCloser, error) {
	return c.client.Open(path)
}

func (s Service) resolveSSHFileTarget(
	ctx context.Context,
	claims authn.Claims,
	payload sshCredentialPayload,
) (sshsessions.ResolvedFileTransferTarget, resolvedFilePolicy, error) {
	target, policy, err := s.resolveSSHPolicy(ctx, claims, strings.TrimSpace(payload.ConnectionID), sshsessions.ResolveConnectionOptions{
		ExpectedType:     "SSH",
		OverrideUsername: strings.TrimSpace(payload.Username),
		OverridePassword: strings.TrimSpace(payload.Password),
		OverrideDomain:   strings.TrimSpace(payload.Domain),
		CredentialMode:   strings.TrimSpace(payload.CredentialMode),
	})
	if err != nil {
		return sshsessions.ResolvedFileTransferTarget{}, resolvedFilePolicy{}, err
	}
	return target, policy, nil
}

func (s Service) withSFTPClient(
	ctx context.Context,
	claims authn.Claims,
	payload sshCredentialPayload,
	fn func(sshRemoteClient, sshsessions.ResolvedFileTransferTarget, resolvedFilePolicy) error,
) error {
	target, policy, err := s.resolveSSHFileTarget(ctx, claims, payload)
	if err != nil {
		return err
	}

	client, cleanup, err := sshtransport.Connect(target.Target, target.Bastion)
	if err != nil {
		return &requestError{status: http.StatusServiceUnavailable, message: sshtransport.MapConnectionError(err)}
	}
	defer cleanup()

	sftpClient, err := sftp.NewClient(client)
	if err != nil {
		return &requestError{status: http.StatusServiceUnavailable, message: "failed to start SFTP subsystem"}
	}
	defer sftpClient.Close()

	return fn(sftpRemoteClient{client: sftpClient}, target, policy)
}

func (s Service) createSSHDirectory(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, remotePath string) error {
	relativePath, err := validateSSHSandboxRelativePath(remotePath, "path", false)
	if err != nil {
		return err
	}
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	if err := s.putSSHWorkspaceDirectory(ctx, workspacePrefix, relativePath); err != nil {
		return err
	}
	if err := s.materializeSSHDirectory(client, scope, relativePath); err != nil {
		_ = s.deleteSSHWorkspacePath(context.WithoutCancel(ctx), workspacePrefix, relativePath)
		return err
	}
	return nil
}

func (s Service) deleteSSHPath(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, remotePath string) error {
	relativePath, err := validateSSHSandboxRelativePath(remotePath, "path", false)
	if err != nil {
		return err
	}
	rollbackCtx := context.WithoutCancel(ctx)
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	snapshot, err := s.captureSSHWorkspaceSnapshot(ctx, workspacePrefix, relativePath)
	if err != nil {
		return err
	}
	if err := s.deleteSSHWorkspacePath(ctx, workspacePrefix, relativePath); err != nil {
		if restoreErr := s.restoreSSHWorkspaceSnapshot(rollbackCtx, workspacePrefix, snapshot); restoreErr != nil {
			return errors.Join(err, restoreErr)
		}
		return err
	}
	if err := s.removeSSHMirrorPath(client, scope, relativePath); err != nil {
		rollbackErrs := []error{err}
		if restoreErr := s.restoreSSHWorkspaceSnapshot(rollbackCtx, workspacePrefix, snapshot); restoreErr != nil {
			rollbackErrs = append(rollbackErrs, restoreErr)
		}
		if mirrorRestoreErr := s.restoreSSHMirrorSnapshot(client, scope, snapshot); mirrorRestoreErr != nil {
			rollbackErrs = append(rollbackErrs, mirrorRestoreErr)
		}
		if len(rollbackErrs) > 1 {
			return errors.Join(rollbackErrs...)
		}
		return err
	}
	return nil
}

func (s Service) renameSSHPath(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, oldPath, newPath string) error {
	oldRelativePath, err := validateSSHSandboxRelativePath(oldPath, "oldPath", false)
	if err != nil {
		return err
	}
	newRelativePath, err := validateSSHSandboxRelativePath(newPath, "newPath", false)
	if err != nil {
		return err
	}
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	snapshot, err := s.captureSSHWorkspaceSnapshot(ctx, workspacePrefix, oldRelativePath)
	if err != nil {
		return err
	}
	rollbackCtx := context.WithoutCancel(ctx)
	rollbackMirror := func(opErr error) error {
		rollbackErrs := []error{opErr}
		if _, restoreErr := s.renameSSHWorkspacePath(rollbackCtx, workspacePrefix, newRelativePath, oldRelativePath); restoreErr != nil {
			rollbackErrs = append(rollbackErrs, restoreErr)
		}
		if mirrorRestoreErr := s.restoreSSHMirrorSnapshot(client, scope, snapshot); mirrorRestoreErr != nil {
			rollbackErrs = append(rollbackErrs, mirrorRestoreErr)
		}
		if cleanupErr := s.removeSSHMirrorPath(client, scope, newRelativePath); cleanupErr != nil {
			rollbackErrs = append(rollbackErrs, cleanupErr)
			if retryRestoreErr := s.restoreSSHMirrorSnapshot(client, scope, snapshot); retryRestoreErr != nil {
				rollbackErrs = append(rollbackErrs, retryRestoreErr)
			}
			if retryCleanupErr := s.removeSSHMirrorPath(client, scope, newRelativePath); retryCleanupErr != nil {
				rollbackErrs = append(rollbackErrs, retryCleanupErr)
			}
		}
		if len(rollbackErrs) > 1 {
			return errors.Join(rollbackErrs...)
		}
		return opErr
	}
	kind, err := s.renameSSHWorkspacePath(ctx, workspacePrefix, oldRelativePath, newRelativePath)
	if err != nil {
		return err
	}
	var mirrorErr error
	if kind == "directory" {
		mirrorErr = s.materializeSSHWorkspaceSubtree(ctx, client, scope, workspacePrefix, newRelativePath)
	} else {
		mirrorErr = s.materializeSSHWorkspaceFile(ctx, client, scope, workspacePrefix, newRelativePath)
	}
	if mirrorErr != nil {
		return rollbackMirror(mirrorErr)
	}
	if err := s.removeSSHMirrorPath(client, scope, oldRelativePath); err != nil {
		return rollbackMirror(err)
	}
	return nil
}

func (s Service) uploadToSSH(
	ctx context.Context,
	client sshRemoteClient,
	target sshsessions.ResolvedFileTransferTarget,
	policy resolvedFilePolicy,
	userID, tenantID, userEmail string,
	fileName, remotePath string,
	payload []byte,
) (managedPayloadResult, error) {
	scope := s.buildReadableManagedSandboxScope(ctx, "ssh", tenantID, userID, target.Connection.ID, "", userEmail)
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	relativePath, err := validateSSHSandboxRelativePath(remotePath, "remotePath", false)
	if err != nil {
		return managedPayloadResult{}, err
	}
	if policy.DisableUpload {
		return managedPayloadResult{}, &requestError{status: http.StatusForbidden, message: "File upload is disabled by organization policy"}
	}

	deps := managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}
	contract, err := managedFileContractFor(managedFileOperationUpload)
	if err != nil {
		return managedPayloadResult{}, err
	}
	result, err := stageManagedPayload(ctx, deps, contract, managedPayloadStageRequest{
		StagePrefix: stagePrefix("ssh", tenantID, userID, target.Connection.ID),
		FileName:    path.Base(relativePath),
		Payload:     payload,
		Metadata: map[string]string{
			"remote-path": sshSandboxDisplayPath(relativePath),
		},
	})
	if err != nil {
		return managedPayloadResult{}, err
	}
	stageCleanupNeeded := true
	defer func() {
		if stageCleanupNeeded {
			s.cleanupManagedStageObject(ctx, result.StageKey, "ssh-upload-failure")
		}
	}()

	cacheInfo, err := s.writeSSHWorkspaceFile(ctx, workspacePrefix, relativePath, result.Payload, result.Metadata)
	if err != nil {
		return result, err
	}
	if err := s.materializeSSHWorkspaceFile(ctx, client, scope, workspacePrefix, relativePath); err != nil {
		_ = s.objectStore().Delete(context.WithoutCancel(ctx), sshWorkspaceFileKey(workspacePrefix, relativePath))
		return result, err
	}
	result.FileName = path.Base(relativePath)
	result.Object = cacheInfo

	if policy.RetainSuccessfulUploads {
		result.Metadata["retained-upload"] = "true"
		if err := s.retainSuccessfulUpload(ctx, historyUploadsPrefix("ssh", tenantID, userID, target.Connection.ID), path.Base(relativePath), result.Payload, result.Metadata, managedHistoryRetentionOptions{Protocol: "ssh", ActorID: userID}); err != nil {
			s.logger().Warn("failed to retain managed ssh upload in history", "file", path.Base(relativePath), "connectionId", target.Connection.ID, "error", err)
		}
	}

	stageCleanupNeeded = false
	s.cleanupManagedStageObject(ctx, result.StageKey, "ssh-upload-success")
	return result, nil
}

func (s Service) downloadFromSSH(
	ctx context.Context,
	target sshsessions.ResolvedFileTransferTarget,
	policy resolvedFilePolicy,
	userID, tenantID, userEmail string,
	remotePath string,
) (sshDownloadStream, error) {
	scope := s.buildReadableManagedSandboxScope(ctx, "ssh", tenantID, userID, target.Connection.ID, "", userEmail)
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	relativePath, err := validateSSHSandboxRelativePath(remotePath, "path", false)
	if err != nil {
		return sshDownloadStream{}, err
	}
	if err := managedDownloadPolicyError(policy); err != nil {
		return sshDownloadStream{}, err
	}

	payload, _, err := s.readSSHWorkspaceFile(ctx, workspacePrefix, relativePath)
	if err != nil {
		return sshDownloadStream{}, err
	}
	deps := managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}
	transfer, err := executeManagedPayloadDownload(ctx, deps, stagePrefix("ssh", tenantID, userID, target.Connection.ID), func() (managedRemotePayload, error) {
		if int64(len(payload)) > s.maxUploadBytes() {
			return managedRemotePayload{}, &requestError{status: http.StatusRequestEntityTooLarge, message: "File exceeds configured transfer limit"}
		}
		return managedRemotePayload{
			FileName: path.Base(relativePath),
			Payload:  payload,
			Metadata: map[string]string{"remote-path": sshSandboxDisplayPath(relativePath)},
		}, nil
	})
	if err != nil {
		return sshDownloadStream{}, err
	}

	deleteStage := func(stageKey string) {
		if stageKey != "" {
			s.cleanupManagedStageObject(ctx, stageKey, "ssh-download")
		}
	}

	reader, object, err := deps.Store.Get(ctx, transfer.StageKey)
	if err != nil {
		deleteStage(transfer.StageKey)
		return sshDownloadStream{}, err
	}
	var cleanupOnce sync.Once
	return sshDownloadStream{
		FileName:           transfer.FileName,
		StageKey:           transfer.StageKey,
		AuditCorrelationID: transfer.AuditCorrelationID,
		Object:             object,
		Reader:             reader,
		cleanup: func() {
			cleanupOnce.Do(func() {
				if err := reader.Close(); err != nil {
					s.logger().Warn("failed to close staged ssh download reader", "stageKey", transfer.StageKey, "error", err)
				}
				deleteStage(transfer.StageKey)
			})
		},
	}, nil
}

func normalizeRemotePath(input string) string {
	clean := strings.TrimSpace(input)
	if clean == "" {
		return "/"
	}
	if !strings.HasPrefix(clean, "/") {
		clean = "/" + clean
	}
	return path.Clean(clean)
}
