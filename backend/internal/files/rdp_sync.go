package files

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

func (s Service) syncDriveToStage(ctx context.Context, drivePath, prefix string) error {
	entries, err := os.ReadDir(drivePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("list drive files: %w", err)
	}

	localFiles := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		localFiles[entry.Name()] = struct{}{}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat drive file: %w", err)
		}
		key := stageObjectKey(prefix, entry.Name())
		stat, err := s.objectStore().Stat(ctx, key)
		if err == nil && stat.Size == info.Size() && stat.ModifiedAt.Unix() == info.ModTime().UTC().Unix() {
			continue
		}
		if err := s.stageLocalFile(ctx, filepath.Join(drivePath, entry.Name()), entry.Name(), key, info.ModTime().UTC()); err != nil {
			if reqErr, ok := err.(*requestError); ok && reqErr.status == http.StatusUnprocessableEntity {
				s.logger().Warn("blocked remote drive file during import", "file", entry.Name(), "reason", reqErr.message)
				continue
			}
			return err
		}
	}

	return nil
}

func (s Service) materializeStageToDrive(ctx context.Context, drivePath, prefix string) error {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("list staged files: %w", err)
	}
	for _, item := range objects {
		name := decodeObjectName(filepath.Base(item.Key))
		targetPath := filepath.Join(drivePath, name)
		currentInfo, err := os.Stat(targetPath)
		if err == nil && currentInfo.Size() == item.Size && currentInfo.ModTime().UTC().Unix() >= item.ModifiedAt.UTC().Unix() {
			continue
		}
		if err := s.materializeObject(ctx, item.Key, targetPath, item.ModifiedAt.UTC()); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) pruneDriveToWorkspace(ctx context.Context, drivePath, prefix string) error {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("list staged files: %w", err)
	}
	expectedFiles := make(map[string]struct{}, len(objects))
	for _, item := range objects {
		expectedFiles[decodeObjectName(filepath.Base(item.Key))] = struct{}{}
	}

	entries, err := os.ReadDir(drivePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("list drive files: %w", err)
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		if _, exists := expectedFiles[entry.Name()]; exists {
			continue
		}
		if err := os.Remove(filepath.Join(drivePath, entry.Name())); err != nil {
			if errors.Is(err, os.ErrNotExist) {
				continue
			}
			return fmt.Errorf("delete drive file: %w", err)
		}
	}
	return nil
}

func (s Service) listManagedRDPFiles(ctx context.Context, drivePath, cachePrefix string) ([]FileInfo, error) {
	if err := s.syncDriveToStage(ctx, drivePath, cachePrefix); err != nil {
		return nil, err
	}
	if err := s.materializeStageToDrive(ctx, drivePath, cachePrefix); err != nil {
		return nil, err
	}
	if err := s.pruneDriveToWorkspace(ctx, drivePath, cachePrefix); err != nil {
		return nil, err
	}
	return s.listStagedFiles(ctx, cachePrefix)
}

func (s Service) listVisibleManagedRDPFiles(ctx context.Context, drivePath, workspacePrefix string, policy resolvedFilePolicy) ([]FileInfo, error) {
	if policy.DisableUpload && policy.DisableDownload {
		return []FileInfo{}, nil
	}
	return s.listManagedRDPFiles(ctx, drivePath, workspacePrefix)
}

func (s Service) uploadManagedRDPFile(ctx context.Context, drivePath, workspacePrefix, uploadPrefix, historyPrefix string, retainSuccessfulUploads bool, fileName string, payload []byte) (managedPayloadResult, error) {
	contract, err := managedFileContractFor(managedFileOperationUpload)
	if err != nil {
		return managedPayloadResult{}, err
	}
	deps := managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}
	transfer, err := stageManagedPayload(ctx, deps, contract, managedPayloadStageRequest{
		StagePrefix: uploadPrefix,
		FileName:    fileName,
		Payload:     payload,
		Metadata: map[string]string{
			"remote-path": managedRDPRemotePath(fileName),
		},
	})
	if err != nil {
		return managedPayloadResult{}, err
	}

	cleanupTransient := func() {
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "rdp-upload")
	}
	rollbackCache := func(cacheKey string) {
		if err := deps.Store.Delete(context.WithoutCancel(ctx), cacheKey); err != nil && !isObjectNotFound(err) {
			s.logger().Warn("failed to rollback cached rdp upload object", "stageKey", cacheKey, "error", err)
		}
	}

	modifiedAt := transfer.Object.ModifiedAt.UTC()
	cacheKey := stageObjectKey(workspacePrefix, fileName)
	cacheMetadata := cloneStringMap(transfer.Metadata)
	cacheMetadata["managed-namespace"] = "workspace/current"
	cacheMetadata["mtime-unix"] = fmt.Sprintf("%d", modifiedAt.Unix())
	if _, err := deps.Store.Put(ctx, cacheKey, transfer.Payload, http.DetectContentType(transfer.Payload), cacheMetadata); err != nil {
		cleanupTransient()
		return transfer, fmt.Errorf("stage drive file: %w", err)
	}
	if err := s.materializeObject(ctx, cacheKey, filepath.Join(drivePath, fileName), modifiedAt); err != nil {
		rollbackCache(cacheKey)
		cleanupTransient()
		return transfer, err
	}
	if retainSuccessfulUploads {
		transfer.Metadata["retained-upload"] = "true"
		cacheMetadata["retained-upload"] = "true"
		if err := s.retainSuccessfulUpload(ctx, historyPrefix, fileName, transfer.Payload, cacheMetadata, managedHistoryRetentionOptions{Protocol: "rdp"}); err != nil {
			s.logger().Warn("failed to retain managed rdp upload in history", "file", fileName, "historyPrefix", historyPrefix, "error", err)
		}
	}
	cleanupTransient()
	return transfer, nil
}

func (s Service) downloadManagedRDPFile(ctx context.Context, drivePath, cachePrefix, downloadPrefix, fileName string) (managedPayloadResult, ObjectInfo, []byte, error) {
	if err := s.syncDriveToStage(ctx, drivePath, cachePrefix); err != nil {
		return managedPayloadResult{}, ObjectInfo{}, nil, err
	}

	deps := managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}
	cacheKey := stageObjectKey(cachePrefix, fileName)
	transfer, err := executeManagedPayloadDownload(ctx, deps, downloadPrefix, func() (managedRemotePayload, error) {
		reader, info, err := deps.Store.Get(ctx, cacheKey)
		if err != nil {
			if isObjectNotFound(err) {
				return managedRemotePayload{}, &requestError{status: http.StatusNotFound, message: "File not found"}
			}
			return managedRemotePayload{}, fmt.Errorf("read staged file: %w", err)
		}
		defer reader.Close()

		if info.Size > s.maxUploadBytes() {
			return managedRemotePayload{}, &requestError{status: http.StatusRequestEntityTooLarge, message: "File exceeds configured transfer limit"}
		}

		payload, err := io.ReadAll(reader)
		if err != nil {
			return managedRemotePayload{}, fmt.Errorf("read staged payload: %w", err)
		}
		return managedRemotePayload{
			FileName: fileName,
			Payload:  payload,
			Metadata: map[string]string{
				"remote-path": managedRDPRemotePath(fileName),
			},
		}, nil
	})
	if err != nil {
		return managedPayloadResult{}, ObjectInfo{}, nil, err
	}

	deleteStage := func() {
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "rdp-download")
	}

	reader, info, err := deps.Store.Get(ctx, transfer.StageKey)
	if err != nil {
		deleteStage()
		return managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("reopen staged object: %w", err)
	}
	payload, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		deleteStage()
		return managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("read staged payload: %w", readErr)
	}
	if closeErr != nil {
		deleteStage()
		return managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("close staged payload: %w", closeErr)
	}
	deleteStage()
	return transfer, info, payload, nil
}

func (s Service) deleteManagedRDPFile(ctx context.Context, drivePath, cachePrefix, fileName string) error {
	if err := s.syncDriveToStage(ctx, drivePath, cachePrefix); err != nil {
		return err
	}

	targetPath := filepath.Join(drivePath, fileName)
	if _, err := os.Stat(targetPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &requestError{status: http.StatusNotFound, message: "File not found"}
		}
		return fmt.Errorf("stat drive file: %w", err)
	}

	if err := s.objectStore().Delete(ctx, stageObjectKey(cachePrefix, fileName)); err != nil && !isObjectNotFound(err) {
		return fmt.Errorf("delete staged file: %w", err)
	}
	if err := os.Remove(targetPath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &requestError{status: http.StatusNotFound, message: "File not found"}
		}
		return fmt.Errorf("delete drive file: %w", err)
	}
	return nil
}

func (s Service) stageLocalFile(ctx context.Context, path, fileName, key string, modifiedAt time.Time) error {
	payload, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read local drive file: %w", err)
	}
	verdict, err := s.scanner().Scan(ctx, fileName, payload)
	if err != nil {
		return fmt.Errorf("scan drive file: %w", err)
	}
	if !verdict.Clean {
		return &requestError{status: http.StatusUnprocessableEntity, message: firstNonEmpty(verdict.Reason, "file blocked by threat scanner")}
	}
	_, err = s.objectStore().Put(ctx, key, payload, http.DetectContentType(payload), map[string]string{
		"managed-namespace": "workspace/current",
		"mtime-unix":        fmt.Sprintf("%d", modifiedAt.Unix()),
	})
	if err != nil {
		return fmt.Errorf("stage drive file: %w", err)
	}
	return nil
}

func (s Service) materializeObject(ctx context.Context, key, targetPath string, modifiedAt time.Time) error {
	reader, _, err := s.objectStore().Get(ctx, key)
	if err != nil {
		return fmt.Errorf("read staged file: %w", err)
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("read staged payload: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return fmt.Errorf("create drive directory: %w", err)
	}
	if err := os.WriteFile(targetPath, payload, 0o644); err != nil {
		return fmt.Errorf("write drive file: %w", err)
	}
	_ = os.Chtimes(targetPath, modifiedAt, modifiedAt)
	return nil
}

func (s Service) listStagedFiles(ctx context.Context, prefix string) ([]FileInfo, error) {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	files := make([]FileInfo, 0, len(objects))
	for _, item := range objects {
		files = append(files, FileInfo{
			Name:       decodeObjectName(filepath.Base(item.Key)),
			Size:       item.Size,
			ModifiedAt: item.ModifiedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, nil
}

func managedRDPRemotePath(fileName string) string {
	return normalizeRemotePath(fileName)
}

func buildManagedRDPPayloadAuditDetails(remotePath, fileName string, size int64, transfer managedPayloadResult) map[string]any {
	return buildManagedTransferAuditDetails("rdp", remotePath, fileName, size, transfer.StageKey, transfer.AuditCorrelationID, transfer.Metadata)
}

func buildManagedRDPMetadataAuditDetails(remotePath string, extra map[string]any) map[string]any {
	return buildManagedMetadataAuditDetails("rdp", remotePath, extra)
}
