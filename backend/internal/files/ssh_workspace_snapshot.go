package files

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strings"
)

type sshWorkspaceSnapshotEntry struct {
	RelativePath string
	IsDir        bool
	Object       ObjectInfo
	Payload      []byte
}

func (s Service) captureSSHWorkspaceSnapshot(ctx context.Context, workspacePrefix, relativePath string) ([]sshWorkspaceSnapshotEntry, error) {
	entries, err := s.sshWorkspaceObjects(ctx, workspacePrefix)
	if err != nil {
		return nil, fmt.Errorf("list sandbox workspace: %w", err)
	}
	kind, exists := sshWorkspacePathState(entries, relativePath)
	if !exists {
		return nil, &requestError{status: http.StatusNotFound, message: "Path not found"}
	}

	snapshot := make([]sshWorkspaceSnapshotEntry, 0)
	prefix := relativePath + "/"
	for _, entry := range entries {
		if entry.RelativePath != relativePath && !strings.HasPrefix(entry.RelativePath, prefix) {
			continue
		}
		captured := sshWorkspaceSnapshotEntry{
			RelativePath: entry.RelativePath,
			IsDir:        entry.IsDir,
			Object:       entry.Info,
		}
		if !entry.IsDir {
			reader, info, err := s.objectStore().Get(ctx, sshWorkspaceFileKey(workspacePrefix, entry.RelativePath))
			if err != nil {
				return nil, fmt.Errorf("read sandbox file for snapshot: %w", err)
			}
			payload, readErr := io.ReadAll(reader)
			closeErr := reader.Close()
			if readErr != nil {
				return nil, fmt.Errorf("read sandbox file for snapshot: %w", readErr)
			}
			if closeErr != nil {
				return nil, fmt.Errorf("close sandbox file for snapshot: %w", closeErr)
			}
			captured.Object = info
			captured.Payload = payload
		}
		snapshot = append(snapshot, captured)
	}
	if kind == "file" && len(snapshot) == 0 {
		return nil, &requestError{status: http.StatusNotFound, message: "Path not found"}
	}
	sort.Slice(snapshot, func(i, j int) bool {
		return snapshot[i].RelativePath < snapshot[j].RelativePath
	})
	return snapshot, nil
}

func (s Service) restoreSSHWorkspaceSnapshot(ctx context.Context, workspacePrefix string, snapshot []sshWorkspaceSnapshotEntry) error {
	if len(snapshot) == 0 {
		return nil
	}
	written := make([]string, 0, len(snapshot))
	for _, entry := range snapshot {
		key := sshWorkspaceDirectoryKey(workspacePrefix, entry.RelativePath)
		payload := []byte(nil)
		contentType := entry.Object.ContentType
		if entry.IsDir {
			if contentType == "" {
				contentType = "application/x-directory"
			}
		} else {
			key = sshWorkspaceFileKey(workspacePrefix, entry.RelativePath)
			payload = entry.Payload
			if contentType == "" {
				contentType = http.DetectContentType(payload)
			}
		}
		if _, err := s.objectStore().Put(ctx, key, payload, contentType, cloneStringMap(entry.Object.Metadata)); err != nil {
			for _, writtenKey := range written {
				_ = s.objectStore().Delete(context.WithoutCancel(ctx), writtenKey)
			}
			return fmt.Errorf("restore sandbox snapshot: %w", err)
		}
		written = append(written, key)
	}
	return nil
}
