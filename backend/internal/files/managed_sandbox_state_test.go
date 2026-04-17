package files

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManagedSandboxPathsUseStageWorkspaceAndHistoryNamespaces(t *testing.T) {
	scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")

	if got := stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID); !strings.Contains(got, "/stage") {
		t.Fatalf("stage prefix = %q; want stage namespace", got)
	}
	if got := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID); !strings.Contains(got, "/workspace/current") {
		t.Fatalf("workspace prefix = %q; want workspace/current namespace", got)
	}
	if got := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID); !strings.Contains(got, "/history/uploads") {
		t.Fatalf("history prefix = %q; want history/uploads namespace", got)
	}
}

func TestManagedSandboxRetentionCopiesSuccessfulUploadToHistory(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	drivePath := t.TempDir()
	scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")

	transfer, err := svc.uploadManagedRDPFile(
		ctx,
		drivePath,
		workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID),
		stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID),
		historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID),
		true,
		"report.txt",
		[]byte("hello history"),
	)
	if err != nil {
		t.Fatalf("uploadManagedRDPFile failed: %v", err)
	}
	if len(store.puts) != 3 {
		t.Fatalf("store puts = %d; want 3 (stage + workspace + history)", len(store.puts))
	}
	if got := store.puts[0].metadata["managed-namespace"]; got != "stage" {
		t.Fatalf("stage namespace = %q; want stage", got)
	}
	if got := store.puts[1].metadata["managed-namespace"]; got != "workspace/current" {
		t.Fatalf("workspace namespace = %q; want workspace/current", got)
	}
	if got := store.puts[2].metadata["managed-namespace"]; got != "history/uploads" {
		t.Fatalf("history namespace = %q; want history/uploads", got)
	}
	if !strings.HasPrefix(store.puts[2].key, historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)+"/") {
		t.Fatalf("history key = %q; want history/uploads prefix", store.puts[2].key)
	}

	stageObjects, err := store.delegate.List(ctx, stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID))
	if err != nil {
		t.Fatalf("list stage objects: %v", err)
	}
	if len(stageObjects) != 0 {
		t.Fatalf("stage objects = %d; want 0 after cleanup", len(stageObjects))
	}
	workspaceObjects, err := store.delegate.List(ctx, workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID))
	if err != nil {
		t.Fatalf("list workspace objects: %v", err)
	}
	if len(workspaceObjects) != 1 {
		t.Fatalf("workspace objects = %d; want 1", len(workspaceObjects))
	}
	historyObjects, err := store.delegate.List(ctx, historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID))
	if err != nil {
		t.Fatalf("list history objects: %v", err)
	}
	if len(historyObjects) != 1 {
		t.Fatalf("history objects = %d; want 1", len(historyObjects))
	}
	if len(store.deletedKeys) != 1 || store.deletedKeys[0] != transfer.StageKey {
		t.Fatalf("deleted keys = %#v; want transient stage cleanup for %q", store.deletedKeys, transfer.StageKey)
	}
}

func TestManagedSandboxReconcilerRemovesStageWorkspaceAndMirrorButKeepsHistory(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	svc := Service{Store: store, DriveBasePath: t.TempDir()}
	scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")

	if _, err := store.delegate.Put(ctx, stageObjectKey(stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "stale.txt"), []byte("stale"), "text/plain", nil); err != nil {
		t.Fatalf("seed stage object: %v", err)
	}
	if _, err := store.delegate.Put(ctx, stageObjectKey(workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "report.txt"), []byte("workspace"), "text/plain", nil); err != nil {
		t.Fatalf("seed workspace object: %v", err)
	}
	if _, err := store.delegate.Put(ctx, historyObjectKey(historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "report.txt", transferTestTime()), []byte("history"), "text/plain", nil); err != nil {
		t.Fatalf("seed history object: %v", err)
	}
	drivePath := svc.userDrivePath(scope.TenantID, scope.UserID, scope.ConnectionID)
	if err := os.MkdirAll(drivePath, 0o755); err != nil {
		t.Fatalf("mkdir drive path: %v", err)
	}
	if err := os.WriteFile(filepath.Join(drivePath, "report.txt"), []byte("workspace"), 0o644); err != nil {
		t.Fatalf("seed drive file: %v", err)
	}

	if err := svc.ReconcileManagedSandbox(ctx, scope, 0); err != nil {
		t.Fatalf("ReconcileManagedSandbox failed: %v", err)
	}
	assertSandboxObjectCount(t, ctx, store, stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), 0)
	assertSandboxObjectCount(t, ctx, store, workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), 0)
	assertSandboxObjectCount(t, ctx, store, historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), 1)
	if _, err := os.Stat(drivePath); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("drive path stat err = %v; want not exist", err)
	}
}

func TestManagedSandboxReconcilerSkipsActiveSessionScope(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	svc := Service{Store: store, DriveBasePath: t.TempDir()}
	scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")

	if _, err := store.delegate.Put(ctx, stageObjectKey(stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "stale.txt"), []byte("stale"), "text/plain", nil); err != nil {
		t.Fatalf("seed stage object: %v", err)
	}
	if _, err := store.delegate.Put(ctx, stageObjectKey(workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "report.txt"), []byte("workspace"), "text/plain", nil); err != nil {
		t.Fatalf("seed workspace object: %v", err)
	}
	drivePath := svc.userDrivePath(scope.TenantID, scope.UserID, scope.ConnectionID)
	if err := os.MkdirAll(drivePath, 0o755); err != nil {
		t.Fatalf("mkdir drive path: %v", err)
	}

	if err := svc.ReconcileManagedSandbox(ctx, scope, 1); err != nil {
		t.Fatalf("ReconcileManagedSandbox failed: %v", err)
	}
	assertSandboxObjectCount(t, ctx, store, stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), 1)
	assertSandboxObjectCount(t, ctx, store, workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), 1)
	if _, err := os.Stat(drivePath); err != nil {
		t.Fatalf("drive path stat err = %v; want existing path", err)
	}
}

func TestManagedSandboxCleanupReturnsDeleteErrorButStillRemovesMirror(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	store.deleteErr = errors.New("delete failed")
	svc := Service{Store: store, DriveBasePath: t.TempDir()}
	scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")

	if _, err := store.delegate.Put(ctx, stageObjectKey(workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), "report.txt"), []byte("workspace"), "text/plain", nil); err != nil {
		t.Fatalf("seed workspace object: %v", err)
	}
	drivePath := svc.userDrivePath(scope.TenantID, scope.UserID, scope.ConnectionID)
	if err := os.MkdirAll(drivePath, 0o755); err != nil {
		t.Fatalf("mkdir drive path: %v", err)
	}

	err := svc.ReconcileManagedSandbox(ctx, scope, 0)
	if !errors.Is(err, store.deleteErr) {
		t.Fatalf("ReconcileManagedSandbox error = %v; want delete error", err)
	}
	if _, statErr := os.Stat(drivePath); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("drive path stat err = %v; want not exist", statErr)
	}
}

func assertSandboxObjectCount(t *testing.T, ctx context.Context, store *recordingObjectStore, prefix string, want int) {
	t.Helper()
	objects, err := store.delegate.List(ctx, prefix)
	if err != nil {
		t.Fatalf("list objects for %q: %v", prefix, err)
	}
	if len(objects) != want {
		t.Fatalf("objects under %q = %d; want %d", prefix, len(objects), want)
	}
}

func transferTestTime() time.Time {
	return time.Unix(1_700_000_000, 0).UTC()
}
