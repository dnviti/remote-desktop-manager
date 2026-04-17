package files

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"sort"
	"strconv"
	"strings"
	"time"
)

const (
	sshWorkspaceFilesNamespace = "files"
	sshWorkspaceDirsNamespace  = "dirs"
)

type sshWorkspaceObject struct {
	Info         ObjectInfo
	RelativePath string
	IsDir        bool
}

func sshWorkspaceFileKey(prefix, relativePath string) string {
	return path.Join(prefix, sshWorkspaceFilesNamespace, encodeObjectName(relativePath))
}

func sshWorkspaceDirectoryKey(prefix, relativePath string) string {
	return path.Join(prefix, sshWorkspaceDirsNamespace, encodeObjectName(relativePath))
}

func parseSSHWorkspaceObject(prefix string, info ObjectInfo) (sshWorkspaceObject, bool) {
	relKey := strings.TrimPrefix(info.Key, strings.TrimSuffix(prefix, "/")+"/")
	if relKey == info.Key {
		return sshWorkspaceObject{}, false
	}
	if rest, ok := strings.CutPrefix(relKey, sshWorkspaceFilesNamespace+"/"); ok {
		return sshWorkspaceObject{Info: info, RelativePath: decodeObjectName(rest), IsDir: false}, true
	}
	if rest, ok := strings.CutPrefix(relKey, sshWorkspaceDirsNamespace+"/"); ok {
		return sshWorkspaceObject{Info: info, RelativePath: decodeObjectName(rest), IsDir: true}, true
	}
	return sshWorkspaceObject{}, false
}

func (s Service) sshWorkspaceObjects(ctx context.Context, workspacePrefix string) ([]sshWorkspaceObject, error) {
	objects, err := s.objectStore().List(ctx, workspacePrefix)
	if err != nil {
		return nil, err
	}
	entries := make([]sshWorkspaceObject, 0, len(objects))
	for _, item := range objects {
		entry, ok := parseSSHWorkspaceObject(workspacePrefix, item)
		if ok {
			entries = append(entries, entry)
		}
	}
	return entries, nil
}

func sshWorkspacePathState(entries []sshWorkspaceObject, relativePath string) (string, bool) {
	for _, entry := range entries {
		if entry.RelativePath != relativePath {
			continue
		}
		if entry.IsDir {
			return "directory", true
		}
		return "file", true
	}
	prefix := relativePath + "/"
	for _, entry := range entries {
		if strings.HasPrefix(entry.RelativePath, prefix) {
			return "directory", true
		}
	}
	return "", false
}

func sshWorkspaceParentPaths(relativePath string) []string {
	if relativePath == "" || relativePath == "." {
		return nil
	}
	parts := strings.Split(relativePath, "/")
	parents := make([]string, 0, len(parts)-1)
	for i := 1; i < len(parts); i++ {
		parents = append(parents, strings.Join(parts[:i], "/"))
	}
	return parents
}

func ensureSSHWorkspaceParentsAreDirectories(entries []sshWorkspaceObject, relativePath, failureMessage string) error {
	for _, parent := range sshWorkspaceParentPaths(relativePath) {
		if kind, exists := sshWorkspacePathState(entries, parent); exists && kind == "file" {
			return &requestError{status: http.StatusBadRequest, message: failureMessage}
		}
	}
	return nil
}

func (s Service) putSSHWorkspaceDirectory(ctx context.Context, workspacePrefix, relativePath string) error {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return fmt.Errorf("list sandbox workspace: %w", err)
	}
	if err := ensureSSHWorkspaceParentsAreDirectories(entries, relativePath, "failed to create sandbox directory"); err != nil {
		return err
	}
	if _, exists := sshWorkspacePathState(entries, relativePath); exists {
		return &requestError{status: http.StatusBadRequest, message: "failed to create sandbox directory"}
	}
	_, err = s.objectStore().Put(ctx, sshWorkspaceDirectoryKey(workspacePrefix, relativePath), nil, "application/x-directory", map[string]string{
		"managed-namespace": "workspace/current",
		"sandbox-path":      relativePath,
		"entry-type":        "directory",
	})
	if err != nil {
		return fmt.Errorf("store sandbox directory marker: %w", err)
	}
	return nil
}

func (s Service) deleteSSHWorkspacePath(ctx context.Context, workspacePrefix, relativePath string) error {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return fmt.Errorf("list sandbox workspace: %w", err)
	}
	kind, exists := sshWorkspacePathState(entries, relativePath)
	if !exists {
		return &requestError{status: http.StatusNotFound, message: "Path not found"}
	}
	if kind == "file" {
		if err := s.objectStore().Delete(ctx, sshWorkspaceFileKey(workspacePrefix, relativePath)); err != nil && !isObjectNotFound(err) {
			return fmt.Errorf("delete sandbox file: %w", err)
		}
		return nil
	}
	prefix := relativePath + "/"
	for _, entry := range entries {
		if entry.RelativePath != relativePath && !strings.HasPrefix(entry.RelativePath, prefix) {
			continue
		}
		key := sshWorkspaceFileKey(workspacePrefix, entry.RelativePath)
		if entry.IsDir {
			key = sshWorkspaceDirectoryKey(workspacePrefix, entry.RelativePath)
		}
		if err := s.objectStore().Delete(ctx, key); err != nil && !isObjectNotFound(err) {
			return fmt.Errorf("delete sandbox path: %w", err)
		}
	}
	return nil
}

func (s Service) renameSSHWorkspacePath(ctx context.Context, workspacePrefix, oldRelativePath, newRelativePath string) (string, error) {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return "", fmt.Errorf("list sandbox workspace: %w", err)
	}
	kind, exists := sshWorkspacePathState(entries, oldRelativePath)
	if !exists {
		return "", &requestError{status: http.StatusNotFound, message: "Path not found"}
	}
	if _, destinationExists := sshWorkspacePathState(entries, newRelativePath); destinationExists {
		return "", &requestError{status: http.StatusBadRequest, message: "failed to rename path"}
	}
	if err := ensureSSHWorkspaceParentsAreDirectories(entries, newRelativePath, "failed to rename path"); err != nil {
		return "", err
	}
	if kind == "directory" && strings.HasPrefix(newRelativePath+"/", oldRelativePath+"/") {
		return "", &requestError{status: http.StatusBadRequest, message: "failed to rename path"}
	}

	writtenKeys := make([]string, 0)
	rollbackWrites := func() {
		for _, key := range writtenKeys {
			_ = s.objectStore().Delete(context.WithoutCancel(ctx), key)
		}
	}

	affectedPrefix := oldRelativePath + "/"
	for _, entry := range entries {
		if entry.RelativePath != oldRelativePath && !strings.HasPrefix(entry.RelativePath, affectedPrefix) {
			continue
		}
		remainder := strings.TrimPrefix(entry.RelativePath, oldRelativePath)
		newPath := strings.TrimPrefix(newRelativePath+remainder, "/")
		metadata := cloneStringMap(entry.Info.Metadata)
		metadata["sandbox-path"] = newPath
		if !entry.IsDir {
			metadata["remote-path"] = sshSandboxDisplayPath(newPath)
		}
		newKey := sshWorkspaceFileKey(workspacePrefix, newPath)
		payload := []byte(nil)
		contentType := entry.Info.ContentType
		if entry.IsDir {
			newKey = sshWorkspaceDirectoryKey(workspacePrefix, newPath)
			if contentType == "" {
				contentType = "application/x-directory"
			}
		} else {
			reader, _, err := s.objectStore().Get(ctx, sshWorkspaceFileKey(workspacePrefix, entry.RelativePath))
			if err != nil {
				rollbackWrites()
				return "", fmt.Errorf("read sandbox file for rename: %w", err)
			}
			payload, err = io.ReadAll(reader)
			closeErr := reader.Close()
			if err != nil {
				rollbackWrites()
				return "", fmt.Errorf("read sandbox file for rename: %w", err)
			}
			if closeErr != nil {
				rollbackWrites()
				return "", fmt.Errorf("close sandbox file for rename: %w", closeErr)
			}
		}
		if _, err := s.objectStore().Put(ctx, newKey, payload, contentType, metadata); err != nil {
			rollbackWrites()
			return "", fmt.Errorf("write sandbox rename target: %w", err)
		}
		writtenKeys = append(writtenKeys, newKey)
	}
	if err := s.deleteSSHWorkspacePath(ctx, workspacePrefix, oldRelativePath); err != nil {
		rollbackWrites()
		return "", err
	}
	return kind, nil
}

func (s Service) writeSSHWorkspaceFile(ctx context.Context, workspacePrefix, relativePath string, payload []byte, metadata map[string]string) (ObjectInfo, error) {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return ObjectInfo{}, fmt.Errorf("list sandbox workspace: %w", err)
	}
	if err := ensureSSHWorkspaceParentsAreDirectories(entries, relativePath, "failed to write sandbox file"); err != nil {
		return ObjectInfo{}, err
	}
	if kind, exists := sshWorkspacePathState(entries, relativePath); exists && kind == "directory" {
		return ObjectInfo{}, &requestError{status: http.StatusBadRequest, message: "failed to write sandbox file"}
	}
	workspaceMetadata := cloneStringMap(metadata)
	workspaceMetadata["managed-namespace"] = "workspace/current"
	workspaceMetadata["sandbox-path"] = relativePath
	workspaceMetadata["remote-path"] = sshSandboxDisplayPath(relativePath)
	workspaceMetadata["mtime-unix"] = strconv.FormatInt(time.Now().UTC().Unix(), 10)
	return s.objectStore().Put(ctx, sshWorkspaceFileKey(workspacePrefix, relativePath), payload, http.DetectContentType(payload), workspaceMetadata)
}

func (s Service) readSSHWorkspaceFile(ctx context.Context, workspacePrefix, relativePath string) ([]byte, ObjectInfo, error) {
	reader, info, err := s.objectStore().Get(ctx, sshWorkspaceFileKey(workspacePrefix, relativePath))
	if err != nil {
		if isObjectNotFound(err) {
			return nil, ObjectInfo{}, &requestError{status: http.StatusNotFound, message: "File not found"}
		}
		return nil, ObjectInfo{}, fmt.Errorf("read sandbox file: %w", err)
	}
	payload, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return nil, ObjectInfo{}, fmt.Errorf("read sandbox file: %w", readErr)
	}
	if closeErr != nil {
		return nil, ObjectInfo{}, fmt.Errorf("close sandbox file: %w", closeErr)
	}
	return payload, info, nil
}

func (s Service) listSSHEntries(ctx context.Context, scope managedSandboxScope, inputPath string) ([]RemoteEntry, error) {
	relativePath, err := validateSSHSandboxRelativePath(inputPath, "path", true)
	if err != nil {
		return nil, err
	}
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return nil, fmt.Errorf("list sandbox workspace: %w", err)
	}
	if relativePath != "." {
		kind, exists := sshWorkspacePathState(entries, relativePath)
		if !exists {
			return nil, &requestError{status: http.StatusNotFound, message: "Path not found"}
		}
		if kind != "directory" {
			return nil, &requestError{status: http.StatusBadRequest, message: "failed to list sandbox directory"}
		}
	}

	children := map[string]RemoteEntry{}
	for _, entry := range entries {
		name, entryType, ok := sshWorkspaceChild(relativePath, entry)
		if !ok {
			continue
		}
		current, exists := children[name]
		candidate := RemoteEntry{
			Name:       name,
			Type:       entryType,
			Size:       0,
			ModifiedAt: entry.Info.ModifiedAt.UTC().Format(time.RFC3339Nano),
		}
		if entryType == "file" {
			candidate.Size = entry.Info.Size
		}
		if !exists || (current.Type != "directory" && candidate.Type == "directory") || current.ModifiedAt < candidate.ModifiedAt {
			children[name] = candidate
		}
	}
	items := make([]RemoteEntry, 0, len(children))
	for _, entry := range children {
		items = append(items, entry)
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

func sshWorkspaceChild(currentPath string, entry sshWorkspaceObject) (string, string, bool) {
	if currentPath == "." {
		currentPath = ""
	}
	relativePath := entry.RelativePath
	if currentPath != "" {
		prefix := currentPath + "/"
		if relativePath == currentPath {
			return "", "", false
		}
		if !strings.HasPrefix(relativePath, prefix) {
			return "", "", false
		}
		relativePath = strings.TrimPrefix(relativePath, prefix)
	}
	if relativePath == "" {
		return "", "", false
	}
	name, rest, found := strings.Cut(relativePath, "/")
	if !found {
		if entry.IsDir {
			return name, "directory", true
		}
		return name, "file", true
	}
	if rest == "" {
		return name, "directory", true
	}
	return name, "directory", true
}
