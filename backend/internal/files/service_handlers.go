package files

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	resolved, policy, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	enableDrive, err := s.rdpDriveEnabled(r.Context(), claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !enableDrive {
		app.ErrorJSON(w, http.StatusConflict, "Shared drive is disabled for this connection")
		return
	}

	drivePath, err := s.ensureUserDrive(claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	workspacePrefix := workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	files, err := s.listVisibleManagedRDPFiles(r.Context(), drivePath, workspacePrefix, policy)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationList), resolved.Connection.ID, requestIP(r),
		buildManagedRDPMetadataAuditDetails("", nil)); err != nil {
		s.logger().Warn("failed to insert managed rdp audit log", "operation", managedFileOperationList, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusOK, files)
}

func (s Service) HandleDownload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	resolved, policy, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := managedDownloadPolicyError(policy); err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		s.writeRequestError(w, err)
		return
	}
	enableDrive, err := s.rdpDriveEnabled(r.Context(), claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !enableDrive {
		app.ErrorJSON(w, http.StatusConflict, "Shared drive is disabled for this connection")
		return
	}

	name := strings.TrimSpace(r.PathValue("name"))
	if _, err := validateFileName(name); err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	drivePath, err := s.ensureUserDrive(claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	workspacePrefix := workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	transfer, info, payload, err := s.downloadManagedRDPFile(
		r.Context(),
		drivePath,
		workspacePrefix,
		stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID),
		name,
	)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDownload), resolved.Connection.ID, requestIP(r),
		buildManagedRDPPayloadAuditDetails(managedRDPRemotePath(name), name, info.Size, transfer)); err != nil {
		s.logger().Warn("failed to insert managed rdp audit log", "operation", managedFileOperationDownload, "connectionId", resolved.Connection.ID, "error", err)
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	http.ServeContent(w, r, name, info.ModifiedAt, bytes.NewReader(payload))
}

func (s Service) HandleUpload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
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
		if errors.Is(err, http.ErrMissingFile) {
			app.ErrorJSON(w, http.StatusBadRequest, "No file uploaded")
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	defer src.Close()

	connectionID := strings.TrimSpace(r.FormValue("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	resolved, policy, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if policy.DisableUpload {
		app.ErrorJSON(w, http.StatusForbidden, "File upload is disabled by organization policy")
		return
	}
	enableDrive, err := s.rdpDriveEnabled(r.Context(), claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !enableDrive {
		app.ErrorJSON(w, http.StatusConflict, "Shared drive is disabled for this connection")
		return
	}
	uploadLimits := s.managedUploadLimits(policy)

	safeName := sanitizeUploadName(header.Filename)
	if err := uploadLimits.validatePayloadSize(header.Size); err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	drivePath, err := s.ensureUserDrive(claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	workspacePrefix := workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err := s.syncDriveToStage(r.Context(), drivePath, workspacePrefix); err != nil {
		s.writeRequestError(w, err)
		return
	}

	data, err := io.ReadAll(io.LimitReader(src, uploadLimits.maxPayloadBytes+1))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	if err := uploadLimits.validatePayloadSize(int64(len(data))); err != nil {
		s.writeRequestError(w, err)
		return
	}

	if uploadLimits.enforcesQuota() {
		currentUsage, err := s.currentStageUsage(r.Context(), workspacePrefix)
		if err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		if err := uploadLimits.validateQuota(currentUsage, int64(len(data))); err != nil {
			s.writeRequestError(w, err)
			return
		}
	}

	transfer, err := s.uploadManagedRDPFile(
		r.Context(),
		drivePath,
		workspacePrefix,
		stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID),
		historyUploadsPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID),
		policy.RetainSuccessfulUploads,
		safeName,
		data,
	)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}

	files, err := s.listManagedRDPFiles(r.Context(), drivePath, workspacePrefix)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationUpload), resolved.Connection.ID, requestIP(r),
		buildManagedRDPPayloadAuditDetails(managedRDPRemotePath(safeName), safeName, int64(len(data)), transfer)); err != nil {
		s.logger().Warn("failed to insert managed rdp audit log", "operation", managedFileOperationUpload, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusCreated, files)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	resolved, _, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	name := strings.TrimSpace(r.PathValue("name"))
	if _, err := validateFileName(name); err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	enableDrive, err := s.rdpDriveEnabled(r.Context(), claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !enableDrive {
		app.ErrorJSON(w, http.StatusConflict, "Shared drive is disabled for this connection")
		return
	}
	drivePath, err := s.ensureUserDrive(claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := s.deleteManagedRDPFile(r.Context(), drivePath, workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), name); err != nil {
		var reqErr *requestError
		if !errors.As(err, &reqErr) || reqErr.status != http.StatusNotFound {
			s.writeRequestError(w, err)
			return
		}
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDelete), resolved.Connection.ID, requestIP(r),
		buildManagedRDPMetadataAuditDetails(name, nil)); err != nil {
		s.logger().Warn("failed to insert managed rdp audit log", "operation", managedFileOperationDelete, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) HandleHistoryList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	resolved, _, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	history, err := s.listManagedHistory(r.Context(), historyUploadsPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID))
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationList), resolved.Connection.ID, requestIP(r),
		buildManagedMetadataAuditDetails("rdp", "", map[string]any{"history": managedAuditDispositionListed})); err != nil {
		s.logger().Warn("failed to insert managed rdp history audit log", "operation", managedFileOperationList, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"items": history})
}

func (s Service) HandleHistoryDownload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	historyID := strings.TrimSpace(r.PathValue("id"))
	resolved, policy, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := managedDownloadPolicyError(policy); err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	entry, transfer, info, payload, err := s.downloadManagedHistory(r.Context(), historyUploadsPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), historyID, policy)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDownload), resolved.Connection.ID, requestIP(r),
		buildManagedRDPPayloadAuditDetails(managedHistoryDisplayPath(entry.FileName), entry.FileName, info.Size, transfer)); err != nil {
		s.logger().Warn("failed to insert managed rdp history download audit log", "operation", managedFileOperationDownload, "connectionId", resolved.Connection.ID, "error", err)
	}
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, entry.FileName))
	http.ServeContent(w, r, entry.FileName, info.ModifiedAt, bytes.NewReader(payload))
}

func (s Service) HandleHistoryRestore(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	historyID := strings.TrimSpace(r.PathValue("id"))
	resolved, policy, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if policy.DisableUpload {
		app.ErrorJSON(w, http.StatusForbidden, "File upload is disabled by organization policy")
		return
	}
	enableDrive, err := s.rdpDriveEnabled(r.Context(), claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !enableDrive {
		app.ErrorJSON(w, http.StatusConflict, "Shared drive is disabled for this connection")
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	drivePath, err := s.ensureUserDrive(claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	entry, transfer, err := s.restoreManagedRDPHistory(r.Context(), drivePath, workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), historyUploadsPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), historyID, strings.TrimSpace(r.URL.Query().Get("name")))
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	files, err := s.listManagedRDPFiles(r.Context(), drivePath, workspaceCurrentPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID))
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationUpload), resolved.Connection.ID, requestIP(r),
		buildManagedRDPPayloadAuditDetails(managedRDPRemotePath(entry.RestoredName), entry.FileName, int64(len(transfer.Payload)), transfer)); err != nil {
		s.logger().Warn("failed to insert managed rdp history restore audit log", "operation", managedFileOperationUpload, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"restored": true, "item": entry, "files": files})
}

func (s Service) HandleHistoryDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.URL.Query().Get("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	historyID := strings.TrimSpace(r.PathValue("id"))
	resolved, _, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	entry, err := s.deleteManagedHistory(r.Context(), historyUploadsPrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), historyID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.insertAuditLog(r.Context(), claims.UserID, managedAuditAction(managedFileOperationDelete), resolved.Connection.ID, requestIP(r),
		buildManagedMetadataAuditDetails("rdp", "", map[string]any{"history": managedAuditDispositionDeleted, "fileName": entry.FileName, "transferId": entry.TransferID, "checksumSha256": entry.ChecksumSHA256})); err != nil {
		s.logger().Warn("failed to insert managed rdp history delete audit log", "operation", managedFileOperationDelete, "connectionId", resolved.Connection.ID, "error", err)
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true, "item": entry})
}

func (s Service) writeRequestError(w http.ResponseWriter, err error) {
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
	if errors.Is(err, ErrSharedFilesStorageUnavailable) {
		app.ErrorJSON(w, http.StatusServiceUnavailable, ErrSharedFilesStorageUnavailable.Error())
		return
	}

	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
