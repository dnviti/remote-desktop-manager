package files

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
	"github.com/dnviti/arsenale/backend/internal/sshtransport"
	"github.com/pkg/sftp"
)

func (s Service) withSFTPClient(
	ctx context.Context,
	claims authn.Claims,
	payload sshCredentialPayload,
	fn func(*sftp.Client, sshsessions.ResolvedFileTransferTarget, resolvedFilePolicy) error,
) error {
	target, policy, err := s.resolveSSHPolicy(ctx, claims, strings.TrimSpace(payload.ConnectionID), sshsessions.ResolveConnectionOptions{
		ExpectedType:     "SSH",
		OverrideUsername: strings.TrimSpace(payload.Username),
		OverridePassword: strings.TrimSpace(payload.Password),
		OverrideDomain:   strings.TrimSpace(payload.Domain),
		CredentialMode:   strings.TrimSpace(payload.CredentialMode),
	})
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

	return fn(sftpClient, target, policy)
}

func (s Service) listSSHEntries(ctx context.Context, client *sftp.Client, remotePath string) ([]RemoteEntry, error) {
	cleanPath := normalizeRemotePath(remotePath)
	entries, err := client.ReadDir(cleanPath)
	if err != nil {
		return nil, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("failed to list %s", cleanPath)}
	}

	items := make([]RemoteEntry, 0, len(entries))
	for _, entry := range entries {
		entryType := "file"
		switch {
		case entry.IsDir():
			entryType = "directory"
		case entry.Mode()&os.ModeSymlink != 0:
			entryType = "symlink"
		}
		items = append(items, RemoteEntry{
			Name:       entry.Name(),
			Size:       entry.Size(),
			Type:       entryType,
			ModifiedAt: entry.ModTime().UTC().Format(time.RFC3339Nano),
		})
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Type == "directory" && items[j].Type != "directory" {
			return true
		}
		if items[i].Type != "directory" && items[j].Type == "directory" {
			return false
		}
		return items[i].Name < items[j].Name
	})
	return items, nil
}

func (s Service) createSSHDirectory(ctx context.Context, client *sftp.Client, remotePath string) error {
	if err := client.Mkdir(normalizeRemotePath(remotePath)); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "failed to create directory"}
	}
	return nil
}

func (s Service) deleteSSHPath(ctx context.Context, client *sftp.Client, remotePath string) error {
	cleanPath := normalizeRemotePath(remotePath)
	info, err := client.Stat(cleanPath)
	if err != nil {
		return &requestError{status: http.StatusNotFound, message: "remote path not found"}
	}
	if info.IsDir() {
		if err := client.RemoveDirectory(cleanPath); err != nil {
			return &requestError{status: http.StatusBadRequest, message: "failed to remove directory"}
		}
		return nil
	}
	if err := client.Remove(cleanPath); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "failed to delete file"}
	}
	return nil
}

func (s Service) renameSSHPath(ctx context.Context, client *sftp.Client, oldPath, newPath string) error {
	if err := client.Rename(normalizeRemotePath(oldPath), normalizeRemotePath(newPath)); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "failed to rename path"}
	}
	return nil
}

func (s Service) uploadToSSH(
	ctx context.Context,
	client *sftp.Client,
	target sshsessions.ResolvedFileTransferTarget,
	policy resolvedFilePolicy,
	userID, tenantID string,
	fileName, remotePath string,
	payload []byte,
) error {
	if policy.DisableUpload {
		return &requestError{status: http.StatusForbidden, message: "File upload is disabled by organization policy"}
	}
	verdict, err := s.scanner().Scan(ctx, fileName, payload)
	if err != nil {
		return fmt.Errorf("scan upload: %w", err)
	}
	if !verdict.Clean {
		return &requestError{status: http.StatusUnprocessableEntity, message: firstNonEmpty(verdict.Reason, "file blocked by threat scanner")}
	}

	stageKey := stageObjectKey(stagePrefix("ssh-upload", tenantID, userID, target.Connection.ID), fmt.Sprintf("%d-%s", time.Now().UTC().UnixNano(), fileName))
	if _, err := s.objectStore().Put(ctx, stageKey, payload, http.DetectContentType(payload), map[string]string{
		"remote-path": normalizeRemotePath(remotePath),
	}); err != nil {
		return fmt.Errorf("stage ssh upload: %w", err)
	}

	dst, err := client.Create(normalizeRemotePath(remotePath))
	if err != nil {
		return &requestError{status: http.StatusBadRequest, message: "failed to create remote file"}
	}
	defer dst.Close()
	if _, err := dst.Write(payload); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "failed to write remote file"}
	}
	return nil
}

func (s Service) downloadFromSSH(
	ctx context.Context,
	client *sftp.Client,
	target sshsessions.ResolvedFileTransferTarget,
	policy resolvedFilePolicy,
	userID, tenantID string,
	remotePath string,
) (string, []byte, error) {
	if policy.DisableDownload {
		return "", nil, &requestError{status: http.StatusForbidden, message: "File download is disabled by organization policy"}
	}

	cleanPath := normalizeRemotePath(remotePath)
	file, err := client.Open(cleanPath)
	if err != nil {
		return "", nil, &requestError{status: http.StatusNotFound, message: "remote file not found"}
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, s.maxUploadBytes()+1))
	if err != nil {
		return "", nil, &requestError{status: http.StatusBadRequest, message: "failed to read remote file"}
	}
	if int64(len(payload)) > s.maxUploadBytes() {
		return "", nil, &requestError{status: http.StatusRequestEntityTooLarge, message: "File exceeds configured transfer limit"}
	}

	fileName := path.Base(cleanPath)
	verdict, err := s.scanner().Scan(ctx, fileName, payload)
	if err != nil {
		return "", nil, fmt.Errorf("scan download: %w", err)
	}
	if !verdict.Clean {
		return "", nil, &requestError{status: http.StatusUnprocessableEntity, message: firstNonEmpty(verdict.Reason, "file blocked by threat scanner")}
	}

	stageKey := stageObjectKey(stagePrefix("ssh-download", tenantID, userID, target.Connection.ID), fmt.Sprintf("%d-%s", time.Now().UTC().UnixNano(), fileName))
	if _, err := s.objectStore().Put(ctx, stageKey, payload, http.DetectContentType(payload), map[string]string{
		"remote-path": cleanPath,
	}); err != nil {
		return "", nil, fmt.Errorf("stage ssh download: %w", err)
	}

	return fileName, payload, nil
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
