package files

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func (s Service) HandleSSHList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshListRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	target, _, err := s.resolveSSHFileTarget(r.Context(), claims, payload.sshCredentialPayload)
	if err != nil {
		s.writeError(w, err)
		return
	}
	scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
	entries, err := s.listSSHEntries(r.Context(), scope, payload.Path)
	if err != nil {
		s.writeError(w, err)
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationList), target.Connection.ID, requestIP(r),
		buildManagedMetadataAuditDetails("ssh", payload.Path, nil))
	app.WriteJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s Service) HandleSSHMkdir(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshPathRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client sshRemoteClient, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
		if err := s.createSSHDirectory(r.Context(), client, scope, payload.Path); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationMkdir), target.Connection.ID, requestIP(r),
			buildManagedMetadataAuditDetails("ssh", payload.Path, nil))
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleSSHDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshPathRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client sshRemoteClient, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
		if err := s.deleteSSHPath(r.Context(), client, scope, payload.Path); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDelete), target.Connection.ID, requestIP(r),
			buildManagedMetadataAuditDetails("ssh", payload.Path, nil))
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleSSHRename(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshRenameRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client sshRemoteClient, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
		if err := s.renameSSHPath(r.Context(), client, scope, payload.OldPath, payload.NewPath); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationRename), target.Connection.ID, requestIP(r),
			buildManagedMetadataAuditDetails("ssh", payload.NewPath, map[string]any{
				"sourceRemotePath": sshSandboxDisplayPath(payload.OldPath),
			}))
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleSSHUpload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	maxUploadBytes := s.maxUploadBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+multipartOverhead)
	if err := r.ParseMultipartForm(maxUploadBytes + multipartOverhead); err != nil {
		if isUploadTooLargeError(err) {
			app.ErrorJSON(w, http.StatusRequestEntityTooLarge, uploadTooLargeMessage(maxUploadBytes))
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid multipart form data")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	src, header, err := r.FormFile("file")
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "No file uploaded")
		return
	}
	defer src.Close()

	payload := sshCredentialPayload{
		ConnectionID:   strings.TrimSpace(r.FormValue("connectionId")),
		Username:       strings.TrimSpace(r.FormValue("username")),
		Password:       strings.TrimSpace(r.FormValue("password")),
		Domain:         strings.TrimSpace(r.FormValue("domain")),
		CredentialMode: strings.TrimSpace(r.FormValue("credentialMode")),
	}
	remotePath := strings.TrimSpace(r.FormValue("remotePath"))
	fileName := sanitizeUploadName(header.Filename)
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	data, err := io.ReadAll(io.LimitReader(src, maxUploadBytes+1))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	if int64(len(data)) > maxUploadBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, uploadTooLargeMessage(maxUploadBytes))
		return
	}

	err = s.withSFTPClient(r.Context(), claims, payload, func(client sshRemoteClient, target sshsessions.ResolvedFileTransferTarget, policy resolvedFilePolicy) error {
		maxConnectionUploadBytes := effectiveUploadLimit(policy.FileUploadMax, maxUploadBytes)
		if int64(len(data)) > maxConnectionUploadBytes {
			return &requestError{status: http.StatusRequestEntityTooLarge, message: uploadTooLargeMessage(maxConnectionUploadBytes)}
		}
		if quota := s.effectiveQuota(tenantFilePolicy{UserDriveQuota: policy.UserDriveQuota}); quota > 0 {
			// Quota is enforced against staged objects for this connection scope.
			usage, err := s.currentStageUsage(r.Context(), stagePrefix("ssh", claims.TenantID, claims.UserID, target.Connection.ID))
			if err != nil {
				return err
			}
			if usage+int64(len(data)) > quota {
				return &requestError{status: http.StatusRequestEntityTooLarge, message: quotaExceededMessage(usage, quota)}
			}
		}
		transfer, err := s.uploadToSSH(r.Context(), client, target, policy, claims.UserID, claims.TenantID, claims.Email, fileName, remotePath, data)
		if err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationUpload), target.Connection.ID, requestIP(r),
			buildManagedTransferAuditDetails("ssh", remotePath, fileName, int64(len(data)), transfer.StageKey, transfer.AuditCorrelationID, transfer.Object.Metadata))
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, map[string]any{"ok": true, "name": fileName})
}

func (s Service) HandleSSHDownload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshPathRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	var download sshDownloadStream
	target, policy, err := s.resolveSSHFileTarget(r.Context(), claims, payload.sshCredentialPayload)
	if err == nil {
		download, err = s.downloadFromSSH(r.Context(), target, policy, claims.UserID, claims.TenantID, claims.Email, payload.Path)
	}
	if err != nil {
		download.Cleanup()
		s.writeError(w, err)
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDownload), target.Connection.ID, requestIP(r),
		buildManagedTransferAuditDetails("ssh", payload.Path, download.FileName, download.Object.Size, download.StageKey, download.AuditCorrelationID, download.Object.Metadata))

	s.writeSSHDownloadResponse(w, r, download)
}

func (s Service) HandleSSHHistoryList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshHistoryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	target, _, err := s.resolveSSHFileTarget(r.Context(), claims, payload.sshCredentialPayload)
	if err != nil {
		s.writeError(w, err)
		return
	}
	scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
	history, err := s.listManagedHistory(r.Context(), historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID))
	if err != nil {
		s.writeError(w, err)
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationList), target.Connection.ID, requestIP(r),
		buildManagedMetadataAuditDetails("ssh", "", map[string]any{"history": managedAuditDispositionListed}))
	app.WriteJSON(w, http.StatusOK, map[string]any{"items": history})
}

func (s Service) HandleSSHHistoryDownload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshHistoryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	target, policy, err := s.resolveSSHFileTarget(r.Context(), claims, payload.sshCredentialPayload)
	if err != nil {
		s.writeError(w, err)
		return
	}
	if err := managedDownloadPolicyError(policy); err != nil {
		s.writeError(w, err)
		return
	}
	entry, transfer, info, served, err := s.downloadManagedHistory(r.Context(), historyUploadsPrefix("ssh", claims.TenantID, claims.UserID, target.Connection.ID), stagePrefix("ssh", claims.TenantID, claims.UserID, target.Connection.ID), payload.ID, policy)
	if err != nil {
		s.writeError(w, err)
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDownload), target.Connection.ID, requestIP(r),
		buildManagedTransferAuditDetails("ssh", managedHistoryDisplayPath(entry.FileName), entry.FileName, info.Size, transfer.StageKey, transfer.AuditCorrelationID, transfer.Metadata))

	stream := sshDownloadStream{
		FileName:           entry.FileName,
		StageKey:           transfer.StageKey,
		AuditCorrelationID: transfer.AuditCorrelationID,
		Object:             info,
		Reader:             io.NopCloser(strings.NewReader(string(served))),
	}
	s.writeSSHDownloadResponse(w, r, stream)
}

func (s Service) HandleSSHHistoryDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshHistoryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	target, _, err := s.resolveSSHFileTarget(r.Context(), claims, payload.sshCredentialPayload)
	if err != nil {
		s.writeError(w, err)
		return
	}
	entry, err := s.deleteManagedHistory(r.Context(), historyUploadsPrefix("ssh", claims.TenantID, claims.UserID, target.Connection.ID), payload.ID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDelete), target.Connection.ID, requestIP(r),
		buildManagedMetadataAuditDetails("ssh", "", map[string]any{"history": managedAuditDispositionDeleted, "fileName": entry.FileName, "transferId": entry.TransferID, "checksumSha256": entry.ChecksumSHA256}))
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true, "item": entry})
}

func (s Service) HandleSSHHistoryRestore(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshHistoryRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client sshRemoteClient, target sshsessions.ResolvedFileTransferTarget, policy resolvedFilePolicy) error {
		if policy.DisableUpload {
			return &requestError{status: http.StatusForbidden, message: "File upload is disabled by organization policy"}
		}
		scope := s.buildReadableManagedSandboxScope(r.Context(), "ssh", claims.TenantID, claims.UserID, target.Connection.ID, "", claims.Email)
		entry, transfer, err := s.restoreManagedSSHHistory(r.Context(), client, scope, target, payload.ID, payload.Path)
		if err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationUpload), target.Connection.ID, requestIP(r),
			buildManagedTransferAuditDetails("ssh", sshSandboxDisplayPath(entry.RestoredName), entry.FileName, int64(len(transfer.Payload)), transfer.StageKey, transfer.AuditCorrelationID, transfer.Metadata))
		app.WriteJSON(w, http.StatusOK, map[string]any{"restored": true, "item": entry})
		return nil
	})
	if err != nil {
		s.writeError(w, err)
	}
}

func (s Service) writeSSHDownloadResponse(w http.ResponseWriter, _ *http.Request, download sshDownloadStream) {
	defer download.Cleanup()

	contentType := firstNonEmpty(download.Object.ContentType, "application/octet-stream")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, download.FileName))
	w.Header().Set("Content-Type", contentType)
	if download.Object.Size > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(download.Object.Size, 10))
	}
	if _, err := io.Copy(w, download.Reader); err != nil {
		s.logger().Warn("failed to stream staged ssh download", "stageKey", download.StageKey, "error", err)
	}
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}

	var resolveErr *sshsessions.ResolveError
	if errors.As(err, &resolveErr) {
		app.ErrorJSON(w, resolveErr.Status, resolveErr.Message)
		return
	}

	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		strings.TrimSpace(r.Header.Get("X-Real-IP")),
		firstForwardedHeader(r.Header.Get("X-Forwarded-For")),
		strings.TrimSpace(r.RemoteAddr),
	} {
		value = stripPort(value)
		value = strings.TrimPrefix(value, "::ffff:")
		if value != "" {
			return value
		}
	}
	return ""
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}

func firstForwardedHeader(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}
