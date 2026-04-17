package files

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"path"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func (s Service) listManagedHistory(ctx context.Context, historyPrefix string) ([]ManagedHistoryEntry, error) {
	objects, err := s.objectStore().List(ctx, historyPrefix)
	if err != nil {
		return nil, err
	}
	entries := make([]ManagedHistoryEntry, 0, len(objects))
	for _, object := range objects {
		entry := managedHistoryEntryFromObject(historyPrefix, object)
		entries = append(entries, entry)
	}
	sort.Slice(entries, func(i, j int) bool {
		if entries[i].TransferAt == entries[j].TransferAt {
			return entries[i].ID > entries[j].ID
		}
		return entries[i].TransferAt > entries[j].TransferAt
	})
	return entries, nil
}

func (s Service) downloadManagedHistory(ctx context.Context, historyPrefix, stagePrefix, historyID string, policy resolvedFilePolicy) (ManagedHistoryEntry, managedPayloadResult, ObjectInfo, []byte, error) {
	if err := managedDownloadPolicyError(policy); err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, err
	}
	entry, info, payload, err := s.readManagedHistoryPayload(ctx, historyPrefix, historyID)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, err
	}
	transfer, err := executeManagedPayloadDownload(ctx, managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}, stagePrefix, func() (managedRemotePayload, error) {
		if int64(len(payload)) > s.maxUploadBytes() {
			return managedRemotePayload{}, &requestError{status: http.StatusRequestEntityTooLarge, message: "File exceeds configured transfer limit"}
		}
		metadata := cloneStringMap(info.Metadata)
		metadata["history-source"] = "true"
		metadata["history-id"] = entry.ID
		metadata["remote-path"] = managedAuditRemotePath(entry.RestoredName, map[string]string{"remote-path": managedHistoryDisplayPath(entry.FileName)})
		return managedRemotePayload{FileName: entry.FileName, Payload: payload, Metadata: metadata}, nil
	})
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, err
	}
	defer s.cleanupManagedStageObject(ctx, transfer.StageKey, "history-download")
	reader, object, err := s.objectStore().Get(ctx, transfer.StageKey)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("reopen staged history object: %w", err)
	}
	served, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("read staged history payload: %w", readErr)
	}
	if closeErr != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, ObjectInfo{}, nil, fmt.Errorf("close staged history payload: %w", closeErr)
	}
	return entry, transfer, object, served, nil
}

func (s Service) deleteManagedHistory(ctx context.Context, historyPrefix, historyID string) (ManagedHistoryEntry, error) {
	entry, _, _, err := s.readManagedHistoryPayload(ctx, historyPrefix, historyID)
	if err != nil {
		return ManagedHistoryEntry{}, err
	}
	if err := s.objectStore().Delete(ctx, entry.ObjectKey); err != nil {
		if isObjectNotFound(err) {
			return ManagedHistoryEntry{}, &requestError{status: http.StatusNotFound, message: "History item not found"}
		}
		return ManagedHistoryEntry{}, fmt.Errorf("delete history object: %w", err)
	}
	return entry, nil
}

func (s Service) restoreManagedRDPHistory(ctx context.Context, drivePath, workspacePrefix, stagePrefix, historyPrefix, historyID, restoreName string) (ManagedHistoryEntry, managedPayloadResult, error) {
	entry, info, payload, err := s.readManagedHistoryPayload(ctx, historyPrefix, historyID)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	targetName := firstNonEmpty(strings.TrimSpace(restoreName), strings.TrimSpace(entry.RestoredName), strings.TrimSpace(entry.FileName))
	targetName, err = validateFileName(targetName)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	metadata := cloneStringMap(info.Metadata)
	metadata["history-source"] = "true"
	metadata["history-id"] = entry.ID
	metadata["remote-path"] = managedRDPRemotePath(targetName)
	transfer, err := executeManagedPayloadRestore(ctx, managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}, managedPayloadStageRequest{
		StagePrefix: stagePrefix,
		FileName:    targetName,
		Payload:     payload,
		Metadata:    metadata,
	})
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	cacheKey := stageObjectKey(workspacePrefix, targetName)
	cacheMetadata := cloneStringMap(transfer.Metadata)
	cacheMetadata["managed-namespace"] = "workspace/current"
	cacheMetadata["mtime-unix"] = fmt.Sprintf("%d", transfer.Object.ModifiedAt.UTC().Unix())
	if _, err := s.objectStore().Put(ctx, cacheKey, transfer.Payload, http.DetectContentType(transfer.Payload), cacheMetadata); err != nil {
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "history-restore-stage")
		return ManagedHistoryEntry{}, managedPayloadResult{}, fmt.Errorf("stage restored drive file: %w", err)
	}
	if err := s.materializeObject(ctx, cacheKey, filepath.Join(drivePath, targetName), transfer.Object.ModifiedAt.UTC()); err != nil {
		_ = s.objectStore().Delete(context.WithoutCancel(ctx), cacheKey)
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "history-restore-materialize")
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	s.cleanupManagedStageObject(ctx, transfer.StageKey, "history-restore-cleanup")
	if err := s.updateManagedHistoryRestoreMetadata(ctx, entry.ObjectKey, payload, info, targetName); err != nil {
		s.logger().Warn("failed to update managed history restore metadata", "historyKey", entry.ObjectKey, "error", err)
	}
	entry.RestoredName = targetName
	return entry, transfer, nil
}

func (s Service) restoreManagedSSHHistory(ctx context.Context, client sshRemoteClient, scope managedSandboxScope, target sshsessions.ResolvedFileTransferTarget, historyID, restorePath string) (ManagedHistoryEntry, managedPayloadResult, error) {
	historyPrefix := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	entry, info, payload, err := s.readManagedHistoryPayload(ctx, historyPrefix, historyID)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	targetPath := firstNonEmpty(strings.TrimSpace(restorePath), strings.TrimSpace(entry.RestoredName), strings.TrimSpace(entry.FileName))
	targetPath, err = validateSSHSandboxRelativePath(targetPath, "path", false)
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	metadata := cloneStringMap(info.Metadata)
	metadata["history-source"] = "true"
	metadata["history-id"] = entry.ID
	metadata["remote-path"] = sshSandboxDisplayPath(targetPath)
	transfer, err := executeManagedPayloadRestore(ctx, managedFileDependencies{Store: s.objectStore(), Scanner: s.scanner()}, managedPayloadStageRequest{
		StagePrefix: stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, target.Connection.ID),
		FileName:    path.Base(targetPath),
		Payload:     payload,
		Metadata:    metadata,
	})
	if err != nil {
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	if _, err := s.writeSSHWorkspaceFile(ctx, workspacePrefix, targetPath, transfer.Payload, transfer.Metadata); err != nil {
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "ssh-history-restore-stage")
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	if err := s.materializeSSHWorkspaceFile(ctx, client, scope, workspacePrefix, targetPath); err != nil {
		_ = s.objectStore().Delete(context.WithoutCancel(ctx), sshWorkspaceFileKey(workspacePrefix, targetPath))
		s.cleanupManagedStageObject(ctx, transfer.StageKey, "ssh-history-restore-materialize")
		return ManagedHistoryEntry{}, managedPayloadResult{}, err
	}
	s.cleanupManagedStageObject(ctx, transfer.StageKey, "ssh-history-restore-cleanup")
	if err := s.updateManagedHistoryRestoreMetadata(ctx, entry.ObjectKey, payload, info, targetPath); err != nil {
		s.logger().Warn("failed to update managed ssh history restore metadata", "historyKey", entry.ObjectKey, "error", err)
	}
	entry.RestoredName = targetPath
	return entry, transfer, nil
}

func (s Service) readManagedHistoryPayload(ctx context.Context, historyPrefix, historyID string) (ManagedHistoryEntry, ObjectInfo, []byte, error) {
	historyKey, err := managedHistoryKey(historyPrefix, historyID)
	if err != nil {
		return ManagedHistoryEntry{}, ObjectInfo{}, nil, err
	}
	reader, info, err := s.objectStore().Get(ctx, historyKey)
	if err != nil {
		if isObjectNotFound(err) {
			return ManagedHistoryEntry{}, ObjectInfo{}, nil, &requestError{status: http.StatusNotFound, message: "History item not found"}
		}
		return ManagedHistoryEntry{}, ObjectInfo{}, nil, fmt.Errorf("read history object: %w", err)
	}
	payload, readErr := io.ReadAll(reader)
	closeErr := reader.Close()
	if readErr != nil {
		return ManagedHistoryEntry{}, ObjectInfo{}, nil, fmt.Errorf("read history payload: %w", readErr)
	}
	if closeErr != nil {
		return ManagedHistoryEntry{}, ObjectInfo{}, nil, fmt.Errorf("close history payload: %w", closeErr)
	}
	info.Key = historyKey
	entry := managedHistoryEntryFromObject(historyPrefix, info)
	return entry, info, payload, nil
}

func (s Service) updateManagedHistoryRestoreMetadata(ctx context.Context, historyKey string, payload []byte, info ObjectInfo, restoredName string) error {
	metadata := cloneStringMap(info.Metadata)
	metadata["history-restored-name"] = strings.TrimSpace(restoredName)
	metadata["history-restored-at"] = time.Now().UTC().Format(time.RFC3339Nano)
	contentType := firstNonEmpty(info.ContentType, http.DetectContentType(payload))
	_, err := s.objectStore().Put(ctx, historyKey, payload, contentType, metadata)
	if err != nil {
		return fmt.Errorf("update history restore metadata: %w", err)
	}
	return nil
}

func managedHistoryEntryFromObject(historyPrefix string, info ObjectInfo) ManagedHistoryEntry {
	metadata := cloneStringMap(info.Metadata)
	entry := ManagedHistoryEntry{
		ID:             managedHistoryID(historyPrefix, info.Key),
		FileName:       firstNonEmpty(strings.TrimSpace(metadata["history-original-file-name"]), historyFileNameFromKey(info.Key)),
		RestoredName:   strings.TrimSpace(metadata["history-restored-name"]),
		Size:           historyObjectSize(info),
		ContentType:    firstNonEmpty(info.ContentType, strings.TrimSpace(metadata["content-type"])),
		TransferAt:     managedHistoryTransferAt(info),
		ActorID:        strings.TrimSpace(metadata["history-actor-id"]),
		Protocol:       firstNonEmpty(strings.TrimSpace(metadata["history-protocol"]), "unknown"),
		TransferID:     firstNonEmpty(strings.TrimSpace(metadata["history-transfer-id"]), strings.TrimSpace(metadata["audit-correlation-id"])),
		ChecksumSHA256: firstNonEmpty(strings.TrimSpace(metadata["history-checksum-sha256"]), strings.TrimSpace(metadata["sha256"])),
		PolicyDecision: firstNonEmpty(strings.TrimSpace(metadata["history-policy-decision"]), managedAuditPolicyAllowed),
		ScanResult:     firstNonEmpty(strings.TrimSpace(metadata["history-scan-result"]), managedAuditScanClean),
		ObjectKey:      info.Key,
		Metadata:       metadata,
		ModifiedAt:     info.ModifiedAt.UTC(),
	}
	return entry
}

func managedHistoryKey(historyPrefix, historyID string) (string, error) {
	id := strings.TrimSpace(historyID)
	if id == "" || strings.Contains(id, "/") || strings.Contains(id, `\`) {
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid history id"}
	}
	return strings.TrimSuffix(strings.TrimSpace(historyPrefix), "/") + "/" + id, nil
}

func managedHistoryID(historyPrefix, objectKey string) string {
	trimmedPrefix := strings.TrimSuffix(strings.TrimSpace(historyPrefix), "/") + "/"
	if strings.HasPrefix(objectKey, trimmedPrefix) {
		return strings.TrimPrefix(objectKey, trimmedPrefix)
	}
	return path.Base(objectKey)
}

func historyFileNameFromKey(objectKey string) string {
	name := path.Base(objectKey)
	if _, rest, ok := strings.Cut(name, "-"); ok {
		return decodeObjectName(rest)
	}
	return decodeObjectName(name)
}

func managedHistoryTransferAt(info ObjectInfo) string {
	if raw := strings.TrimSpace(info.Metadata["history-transfer-at"]); raw != "" {
		return raw
	}
	return info.ModifiedAt.UTC().Format(time.RFC3339Nano)
}

func historyObjectSize(info ObjectInfo) int64 {
	if raw := strings.TrimSpace(info.Metadata["history-size-bytes"]); raw != "" {
		if size, err := strconv.ParseInt(raw, 10, 64); err == nil {
			return size
		}
	}
	return info.Size
}

func managedHistoryDisplayPath(fileName string) string {
	return normalizeRemotePath(strings.TrimSpace(fileName))
}
