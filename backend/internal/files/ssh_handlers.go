package files

import (
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/pkg/sftp"
)

func (s Service) HandleSSHList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshListRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	var entries []RemoteEntry
	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		items, err := s.listSSHEntries(r.Context(), client, payload.Path)
		if err != nil {
			return err
		}
		entries = items
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"entries": entries})
}

func (s Service) HandleSSHMkdir(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload sshPathRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		if err := s.createSSHDirectory(r.Context(), client, payload.Path); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, "SFTP_MKDIR", target.Connection.ID, requestIP(r), map[string]any{"path": normalizeRemotePath(payload.Path)})
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

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		if err := s.deleteSSHPath(r.Context(), client, payload.Path); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, "SFTP_DELETE", target.Connection.ID, requestIP(r), map[string]any{"path": normalizeRemotePath(payload.Path)})
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

	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, _ resolvedFilePolicy) error {
		if err := s.renameSSHPath(r.Context(), client, payload.OldPath, payload.NewPath); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, "SFTP_RENAME", target.Connection.ID, requestIP(r), map[string]any{
			"oldPath": normalizeRemotePath(payload.OldPath),
			"newPath": normalizeRemotePath(payload.NewPath),
		})
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

	data, err := io.ReadAll(io.LimitReader(src, maxUploadBytes+1))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	if int64(len(data)) > maxUploadBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, "File exceeds maximum upload size")
		return
	}

	err = s.withSFTPClient(r.Context(), claims, payload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, policy resolvedFilePolicy) error {
		if quota := s.effectiveQuota(tenantFilePolicy{UserDriveQuota: policy.UserDriveQuota}); quota > 0 {
			// Quota is enforced against staged objects for this connection scope.
			usage, err := s.currentStageUsage(r.Context(), stagePrefix("ssh-upload", claims.TenantID, claims.UserID, target.Connection.ID))
			if err != nil {
				return err
			}
			if usage+int64(len(data)) > quota {
				return &requestError{status: http.StatusRequestEntityTooLarge, message: quotaExceededMessage(usage, quota)}
			}
		}
		if err := s.uploadToSSH(r.Context(), client, target, policy, claims.UserID, claims.TenantID, fileName, remotePath, data); err != nil {
			return err
		}
		_ = s.insertAuditLog(r.Context(), claims.UserID, "SFTP_UPLOAD", target.Connection.ID, requestIP(r), map[string]any{
			"path":     normalizeRemotePath(remotePath),
			"filename": fileName,
			"size":     len(data),
		})
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

	var (
		fileName string
		data     []byte
	)
	err := s.withSFTPClient(r.Context(), claims, payload.sshCredentialPayload, func(client *sftp.Client, target sshsessions.ResolvedFileTransferTarget, policy resolvedFilePolicy) error {
		name, payloadBytes, err := s.downloadFromSSH(r.Context(), client, target, policy, claims.UserID, claims.TenantID, payload.Path)
		if err != nil {
			return err
		}
		fileName = name
		data = payloadBytes
		_ = s.insertAuditLog(r.Context(), claims.UserID, "SFTP_DOWNLOAD", target.Connection.ID, requestIP(r), map[string]any{
			"path":     normalizeRemotePath(payload.Path),
			"filename": name,
			"size":     len(payloadBytes),
		})
		return nil
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, fileName))
	w.Header().Set("Content-Type", http.DetectContentType(data))
	_, _ = w.Write(data)
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
