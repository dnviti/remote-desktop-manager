package files

import (
	"context"
	"fmt"
	"io"
	"path"
	"strings"
	"time"
)

func sshWorkspaceMirrorRootPath(homeDir string, scope managedSandboxScope) string {
	return sshWorkspaceMirrorPathForScope(homeDir, scope)
}

func (s Service) sshMirrorRootPath(client sshRemoteClient, scope managedSandboxScope) (string, error) {
	homeDir, err := client.Getwd()
	if err != nil {
		return "", &requestError{status: 503, message: "failed to synchronize SSH sandbox"}
	}
	var lastErr error
	for _, rootPath := range sshWorkspaceMirrorRootCandidates(homeDir, scope) {
		if err := ensureSSHMirrorRootWritable(client, rootPath); err == nil {
			return rootPath, nil
		} else {
			lastErr = err
		}
	}
	if lastErr != nil {
		return "", wrapSSHMirrorError(lastErr)
	}
	return "", &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
}

func ensureSSHMirrorDirectory(client sshRemoteClient, directoryPath string) error {
	normalized := normalizeSSHRemoteBasePath(directoryPath)
	if strings.TrimSpace(normalized) == "" {
		return nil
	}
	current, segments := splitSSHRemotePath(normalized)
	for _, segment := range segments {
		if segment == "" {
			continue
		}
		current = joinSSHRemotePath(current, segment)
		info, err := client.Stat(current)
		if err == nil && info != nil && info.IsDir() {
			continue
		}
		if err := client.Mkdir(current); err != nil {
			return err
		}
	}
	return nil
}

func ensureSSHMirrorRootWritable(client sshRemoteClient, rootPath string) error {
	if err := ensureSSHMirrorDirectory(client, rootPath); err != nil {
		return err
	}
	probePath := joinSSHRemotePath(rootPath, ".arsenale-write-test")
	if info, err := client.Stat(probePath); err == nil && info != nil && info.IsDir() {
		return nil
	}
	if err := client.Mkdir(probePath); err != nil {
		return err
	}
	return nil
}

func splitSSHRemotePath(value string) (string, []string) {
	normalized := normalizeSSHRemoteBasePath(value)
	if isSSHWindowsDrivePath(normalized) {
		rest := strings.TrimPrefix(normalized[3:], "/")
		segments := []string{}
		if rest != "" {
			segments = strings.Split(rest, "/")
		}
		return normalized[:3], segments
	}
	rest := strings.TrimPrefix(normalized, "/")
	segments := []string{}
	if rest != "" {
		segments = strings.Split(rest, "/")
	}
	return "/", segments
}

func sshRemoteDir(value string) string {
	normalized := normalizeSSHRemoteBasePath(value)
	if isSSHWindowsDrivePath(normalized) {
		driveRoot := normalized[:3]
		rest := strings.TrimPrefix(normalized[3:], "/")
		if rest == "" {
			return driveRoot
		}
		parent := path.Dir("/" + rest)
		if parent == "/" || parent == "." {
			return driveRoot
		}
		return driveRoot + strings.TrimPrefix(parent, "/")
	}
	return path.Dir(normalized)
}

func sshWorkspaceMirrorRootCandidates(homeDir string, scope managedSandboxScope) []string {
	bases := sshWorkspaceMirrorBaseCandidates(homeDir)
	seen := make(map[string]struct{}, len(bases))
	roots := make([]string, 0, len(bases))
	for _, base := range bases {
		root := sshWorkspaceMirrorRootPath(base, scope)
		if _, ok := seen[root]; ok {
			continue
		}
		seen[root] = struct{}{}
		roots = append(roots, root)
	}
	return roots
}

func sshWorkspaceMirrorBaseCandidates(homeDir string) []string {
	normalized := normalizeSSHRemoteBasePath(homeDir)
	seen := map[string]struct{}{}
	candidates := make([]string, 0, 5)
	appendCandidate := func(candidate string) {
		candidate = normalizeSSHRemoteBasePath(candidate)
		if candidate == "" {
			return
		}
		if _, ok := seen[candidate]; ok {
			return
		}
		seen[candidate] = struct{}{}
		candidates = append(candidates, candidate)
	}
	appendCandidate(normalized)
	if driveRoot, username, ok := sshWindowsDriveRootAndUser(normalized); ok {
		if username != "" {
			appendCandidate(joinSSHRemotePath(driveRoot, "Users", username, "AppData", "Local", "Temp"))
		}
		appendCandidate(joinSSHRemotePath(driveRoot, "Windows", "Temp"))
		appendCandidate(joinSSHRemotePath(driveRoot, "Temp"))
		appendCandidate(joinSSHRemotePath(driveRoot, "Users", "Public"))
		return candidates
	}
	appendCandidate("/tmp")
	appendCandidate("/var/tmp")
	appendCandidate("/dev/shm")
	return candidates
}

func sshWindowsDriveRootAndUser(homeDir string) (string, string, bool) {
	normalized := normalizeSSHRemoteBasePath(homeDir)
	if !isSSHWindowsDrivePath(normalized) {
		return "", "", false
	}
	driveRoot := normalized[:3]
	segments := strings.Split(strings.TrimPrefix(normalized[3:], "/"), "/")
	if len(segments) >= 2 && strings.EqualFold(segments[0], "Users") {
		return driveRoot, strings.TrimSpace(segments[1]), true
	}
	return driveRoot, "", true
}

func removeSSHMirrorTree(client sshRemoteClient, targetPath string) error {
	info, err := client.Stat(targetPath)
	if err != nil || info == nil {
		return nil
	}
	if !info.IsDir() {
		return client.Remove(targetPath)
	}
	entries, err := client.ReadDir(targetPath)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		childPath := joinSSHRemotePath(targetPath, entry.Name())
		if entry.IsDir() {
			if err := removeSSHMirrorTree(client, childPath); err != nil {
				return err
			}
			continue
		}
		if err := client.Remove(childPath); err != nil {
			return err
		}
	}
	return client.RemoveDirectory(targetPath)
}

func materializeSSHMirrorFile(client sshRemoteClient, targetPath string, payload []byte) error {
	targetPath = normalizeSSHRemoteBasePath(targetPath)
	targetDir := sshRemoteDir(targetPath)
	if err := wrapSSHMirrorError(ensureSSHMirrorDirectory(client, targetDir)); err != nil {
		return err
	}
	baseName := path.Base(strings.ReplaceAll(targetPath, `\`, "/"))
	tempPath := joinSSHRemotePath(targetDir, fmt.Sprintf(".%s.tmp.%d", baseName, time.Now().UTC().UnixNano()))
	writer, err := client.Create(tempPath)
	if err != nil {
		return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
	}
	if _, err := io.Copy(writer, strings.NewReader(string(payload))); err != nil {
		_ = writer.Close()
		_ = client.Remove(tempPath)
		return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
	}
	if err := writer.Close(); err != nil {
		_ = client.Remove(tempPath)
		return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
	}
	if info, err := client.Stat(targetPath); err == nil && info != nil {
		if info.IsDir() {
			_ = client.Remove(tempPath)
			return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
		}
		if err := client.Remove(targetPath); err != nil {
			_ = client.Remove(tempPath)
			return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
		}
	} else if err != nil && err != context.Canceled && err != context.DeadlineExceeded && err != io.EOF {
		if err != nil && !isSSHNotExistError(err) {
			_ = client.Remove(tempPath)
			return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
		}
	}
	if err := client.Rename(tempPath, targetPath); err != nil {
		_ = client.Remove(tempPath)
		return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
	}
	return nil
}

func isSSHNotExistError(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "not exist") || strings.Contains(strings.ToLower(err.Error()), "no such file")
}

func (s Service) materializeSSHDirectory(client sshRemoteClient, scope managedSandboxScope, relativePath string) error {
	rootPath, err := s.sshMirrorRootPath(client, scope)
	if err != nil {
		return err
	}
	return wrapSSHMirrorError(ensureSSHMirrorDirectory(client, joinSSHRemotePath(rootPath, relativePath)))
}

func (s Service) materializeSSHWorkspaceFile(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, workspacePrefix, relativePath string) error {
	rootPath, err := s.sshMirrorRootPath(client, scope)
	if err != nil {
		return err
	}
	payload, _, err := s.readSSHWorkspaceFile(ctx, workspacePrefix, relativePath)
	if err != nil {
		return err
	}
	return materializeSSHMirrorFile(client, joinSSHRemotePath(rootPath, relativePath), payload)
}

func (s Service) materializeSSHWorkspaceSubtree(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, workspacePrefix, relativePath string) error {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return fmt.Errorf("list sandbox workspace: %w", err)
	}
	if err := s.materializeSSHDirectory(client, scope, relativePath); err != nil {
		return err
	}
	prefix := relativePath + "/"
	for _, entry := range entries {
		if entry.RelativePath != relativePath && !strings.HasPrefix(entry.RelativePath, prefix) {
			continue
		}
		if entry.IsDir {
			if err := s.materializeSSHDirectory(client, scope, entry.RelativePath); err != nil {
				return err
			}
			continue
		}
		if err := s.materializeSSHWorkspaceFile(ctx, client, scope, workspacePrefix, entry.RelativePath); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) restoreSSHMirrorSnapshot(client sshRemoteClient, scope managedSandboxScope, snapshot []sshWorkspaceSnapshotEntry) error {
	if len(snapshot) == 0 {
		return nil
	}
	rootPath, err := s.sshMirrorRootPath(client, scope)
	if err != nil {
		return err
	}
	for _, entry := range snapshot {
		targetPath := joinSSHRemotePath(rootPath, entry.RelativePath)
		if entry.IsDir {
			if err := wrapSSHMirrorError(ensureSSHMirrorDirectory(client, targetPath)); err != nil {
				return err
			}
			continue
		}
		if err := materializeSSHMirrorFile(client, targetPath, entry.Payload); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) removeSSHMirrorPath(client sshRemoteClient, scope managedSandboxScope, relativePath string) error {
	rootPath, err := s.sshMirrorRootPath(client, scope)
	if err != nil {
		return err
	}
	return wrapSSHMirrorError(removeSSHMirrorTree(client, joinSSHRemotePath(rootPath, relativePath)))
}

func wrapSSHMirrorError(err error) error {
	if err == nil {
		return nil
	}
	return &requestError{status: 400, message: "failed to synchronize SSH sandbox"}
}
