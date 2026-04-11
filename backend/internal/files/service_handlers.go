package files

import (
	"bytes"
	"errors"
	"fmt"
	"io"
	"net/http"
	"path/filepath"
	"strings"
	"time"

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
	resolved, _, err := s.resolveRDPPolicy(r.Context(), claims, connectionID)
	if err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	drivePath, err := s.ensureUserDrive(claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	prefix := stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err := s.syncDriveToStage(r.Context(), drivePath, prefix); err != nil {
		s.writeRequestError(w, err)
		return
	}
	if err := s.materializeStageToDrive(r.Context(), drivePath, prefix); err != nil {
		s.writeRequestError(w, err)
		return
	}
	files, err := s.listStagedFiles(r.Context(), prefix)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
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
	if policy.DisableDownload {
		app.ErrorJSON(w, http.StatusForbidden, "File download is disabled by organization policy")
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
	drivePath, err := s.ensureUserDrive(claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	prefix := stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err := s.syncDriveToStage(r.Context(), drivePath, prefix); err != nil {
		s.writeRequestError(w, err)
		return
	}
	reader, info, err := s.objectStore().Get(r.Context(), stageObjectKey(prefix, name))
	if err != nil {
		if isObjectNotFound(err) {
			app.ErrorJSON(w, http.StatusNotFound, "File not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	defer reader.Close()
	payload, err := io.ReadAll(reader)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	http.ServeContent(w, r, name, info.ModifiedAt, bytes.NewReader(payload))
}

func (s Service) HandleUpload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	maxUploadBytes := s.maxUploadBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+multipartOverhead)
	if err := r.ParseMultipartForm(maxUploadBytes + multipartOverhead); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			app.ErrorJSON(w, http.StatusRequestEntityTooLarge, "File exceeds maximum upload size")
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

	safeName := sanitizeUploadName(header.Filename)
	maxTenantBytes := policy.FileUploadMax
	if maxTenantBytes != nil && header.Size > *maxTenantBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("File exceeds organization limit of %dMB", bytesToMB(*maxTenantBytes)))
		return
	}
	if err := s.ensureReady(r.Context()); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	drivePath, err := s.ensureUserDrive(claims.UserID, resolved.Connection.ID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	prefix := stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID)
	if err := s.syncDriveToStage(r.Context(), drivePath, prefix); err != nil {
		s.writeRequestError(w, err)
		return
	}

	data, err := io.ReadAll(io.LimitReader(src, maxUploadBytes+1))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	if int64(len(data)) > maxUploadBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, "File exceeds maximum upload size")
		return
	}
	if maxTenantBytes != nil && int64(len(data)) > *maxTenantBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("File exceeds organization limit of %dMB", bytesToMB(*maxTenantBytes)))
		return
	}

	currentUsage, err := s.currentStageUsage(r.Context(), prefix)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if quota := s.effectiveQuota(tenantFilePolicy{UserDriveQuota: policy.UserDriveQuota}); quota > 0 && currentUsage+int64(len(data)) > quota {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, quotaExceededMessage(currentUsage, quota))
		return
	}

	verdict, err := s.scanner().Scan(r.Context(), safeName, data)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !verdict.Clean {
		app.ErrorJSON(w, http.StatusUnprocessableEntity, firstNonEmpty(verdict.Reason, "file blocked by threat scanner"))
		return
	}
	key := stageObjectKey(prefix, safeName)
	modifiedAt := time.Now().UTC()
	if _, err := s.objectStore().Put(r.Context(), key, data, http.DetectContentType(data), map[string]string{
		"mtime-unix": fmt.Sprintf("%d", modifiedAt.Unix()),
	}); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := s.materializeObject(r.Context(), key, filepath.Join(drivePath, safeName), modifiedAt); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	files, err := s.listStagedFiles(r.Context(), prefix)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
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
	if err := s.DeleteFile(claims.UserID, resolved.Connection.ID, name); err != nil {
		var reqErr *requestError
		if !errors.As(err, &reqErr) || reqErr.status != http.StatusNotFound {
			s.writeRequestError(w, err)
			return
		}
	}
	if err := s.objectStore().Delete(r.Context(), stageObjectKey(stagePrefix("rdp", claims.TenantID, claims.UserID, resolved.Connection.ID), name)); err != nil && !isObjectNotFound(err) {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
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

	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
