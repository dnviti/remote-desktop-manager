package files

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"
)

type managedSandboxScope struct {
	Protocol     string
	TenantID     string
	UserID       string
	ConnectionID string
	TenantLabel  string
	UserLabel    string
	ConnectionLabel string
}

func newManagedSandboxScope(protocol, tenantID, userID, connectionID string) managedSandboxScope {
	return managedSandboxScope{
		Protocol:     normalizeSandboxProtocol(protocol),
		TenantID:     strings.TrimSpace(tenantID),
		UserID:       strings.TrimSpace(userID),
		ConnectionID: strings.TrimSpace(connectionID),
	}
}

func newManagedSandboxScopeWithLabels(protocol, tenantID, userID, connectionID, tenantLabel, userLabel, connectionLabel string) managedSandboxScope {
	scope := newManagedSandboxScope(protocol, tenantID, userID, connectionID)
	scope.TenantLabel = strings.TrimSpace(tenantLabel)
	scope.UserLabel = strings.TrimSpace(userLabel)
	scope.ConnectionLabel = strings.TrimSpace(connectionLabel)
	return scope
}

func historyObjectKey(prefix, fileName string, now time.Time) string {
	return stageObjectKey(prefix, fmt.Sprintf("%d-%s", now.UTC().UnixNano(), fileName))
}

func (s Service) retainSuccessfulUpload(ctx context.Context, historyPrefix, fileName string, payload []byte, metadata map[string]string, opts managedHistoryRetentionOptions) error {
	historyPrefix = strings.TrimSpace(historyPrefix)
	fileName = strings.TrimSpace(fileName)
	if historyPrefix == "" || fileName == "" {
		return nil
	}

	now := time.Now().UTC()
	historyMetadata := cloneStringMap(metadata)
	historyMetadata["managed-namespace"] = "history/uploads"
	historyMetadata["retained-upload"] = "true"
	historyMetadata["history-original-file-name"] = fileName
	historyMetadata["history-transfer-at"] = now.Format(time.RFC3339Nano)
	historyMetadata["history-protocol"] = normalizeSandboxProtocol(opts.Protocol)
	historyMetadata["history-size-bytes"] = fmt.Sprintf("%d", len(payload))
	historyMetadata["history-policy-decision"] = firstNonEmpty(strings.TrimSpace(historyMetadata["history-policy-decision"]), managedAuditPolicyAllowed)
	historyMetadata["history-scan-result"] = firstNonEmpty(strings.TrimSpace(historyMetadata["history-scan-result"]), managedAuditScanClean)
	if actorID := strings.TrimSpace(opts.ActorID); actorID != "" {
		historyMetadata["history-actor-id"] = actorID
	}
	if transferID := firstNonEmpty(strings.TrimSpace(historyMetadata["history-transfer-id"]), strings.TrimSpace(historyMetadata["audit-correlation-id"])); transferID != "" {
		historyMetadata["history-transfer-id"] = transferID
	}
	if checksum := firstNonEmpty(strings.TrimSpace(historyMetadata["history-checksum-sha256"]), strings.TrimSpace(historyMetadata["sha256"]), strings.TrimSpace(historyMetadata["payload-sha256"])); checksum != "" {
		historyMetadata["history-checksum-sha256"] = checksum
	}
	_, err := s.objectStore().Put(ctx,
		historyObjectKey(historyPrefix, fileName, now),
		payload,
		http.DetectContentType(payload),
		historyMetadata,
	)
	if err != nil {
		return fmt.Errorf("retain successful upload: %w", err)
	}
	return nil
}

func (s Service) cleanupManagedStageObject(ctx context.Context, stageKey, reason string) {
	stageKey = strings.TrimSpace(stageKey)
	if stageKey == "" {
		return
	}
	cleanupCtx := context.WithoutCancel(ctx)
	if err := s.objectStore().Delete(cleanupCtx, stageKey); err != nil && !isObjectNotFound(err) {
		s.logger().Warn("failed to delete managed sandbox stage object", "stageKey", stageKey, "reason", strings.TrimSpace(reason), "error", err)
	}
}

func (s Service) deleteManagedPrefix(ctx context.Context, prefix string) error {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("list managed sandbox prefix %s: %w", prefix, err)
	}
	for _, item := range objects {
		if err := s.objectStore().Delete(ctx, item.Key); err != nil && !isObjectNotFound(err) {
			return fmt.Errorf("delete managed sandbox object %s: %w", item.Key, err)
		}
	}
	return nil
}

func (s Service) cleanupManagedWorkspaceMirror(scope managedSandboxScope) error {
	drivePath := s.userDrivePath(scope.TenantID, scope.UserID, scope.ConnectionID)
	if err := os.RemoveAll(drivePath); err != nil {
		return fmt.Errorf("remove managed workspace mirror %s: %w", drivePath, err)
	}
	return nil
}

func (s Service) cleanupManagedSandbox(ctx context.Context, scope managedSandboxScope) error {
	cleanupCtx := context.WithoutCancel(ctx)
	var errs []error
	for _, prefix := range []string{
		stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID),
		workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID),
	} {
		if err := s.deleteManagedPrefix(cleanupCtx, prefix); err != nil {
			errs = append(errs, err)
		}
	}
	if err := s.cleanupManagedWorkspaceMirror(scope); err != nil {
		errs = append(errs, err)
	}
	return errors.Join(errs...)
}

func (s Service) ReconcileManagedSandbox(ctx context.Context, scope managedSandboxScope, activeSessionCount int) error {
	if activeSessionCount > 0 {
		return nil
	}
	if scope.Protocol == "" || scope.UserID == "" || scope.ConnectionID == "" {
		return nil
	}
	return s.cleanupManagedSandbox(ctx, scope)
}
