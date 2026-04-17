package files

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestRDPManagedSandboxDrivePathUsesUserAndConnectionIsolation(t *testing.T) {
	basePath := t.TempDir()
	pathOne := DrivePath(basePath, "tenant-1", "user-1", "conn-1")
	pathTwo := DrivePath(basePath, "tenant-2", "user-2", "conn-2")

	if pathOne == pathTwo {
		t.Fatalf("drive paths should differ across user/connection scopes, got %q", pathOne)
	}
	wantPathOne := filepath.Join(basePath, "user-1", "conn-1")
	if pathOne != wantPathOne {
		t.Fatalf("drive path = %q; want %q", pathOne, wantPathOne)
	}
}

func TestRDPManagedSandboxListMaterializesWorkspaceWithoutHistory(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	historyPrefix := historyUploadsPrefix("rdp", "tenant-1", "user-1", "conn-1")
	if _, err := store.delegate.Put(ctx, stageObjectKey(workspacePrefix, "report.txt"), []byte("workspace payload"), "text/plain", map[string]string{"mtime-unix": "1700000000"}); err != nil {
		t.Fatalf("seed workspace object: %v", err)
	}
	if _, err := store.delegate.Put(ctx, historyObjectKey(historyPrefix, "report.txt", transferTestTime()), []byte("history payload"), "text/plain", map[string]string{"managed-namespace": "history/uploads"}); err != nil {
		t.Fatalf("seed history object: %v", err)
	}

	files, err := svc.listManagedRDPFiles(ctx, drivePath, workspacePrefix)
	if err != nil {
		t.Fatalf("listManagedRDPFiles failed: %v", err)
	}
	if len(files) != 1 {
		t.Fatalf("len(files) = %d; want 1", len(files))
	}
	if files[0].Name != "report.txt" {
		t.Fatalf("file name = %q; want report.txt", files[0].Name)
	}
	payload, err := os.ReadFile(filepath.Join(drivePath, "report.txt"))
	if err != nil {
		t.Fatalf("read materialized drive file: %v", err)
	}
	if string(payload) != "workspace payload" {
		t.Fatalf("drive payload = %q; want workspace payload", payload)
	}
	entries, err := os.ReadDir(drivePath)
	if err != nil {
		t.Fatalf("read drive directory: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "report.txt" {
		t.Fatalf("drive entries = %#v; want only report.txt", entries)
	}
	if len(scanner.scans) != 0 {
		t.Fatalf("scanner calls = %d; want 0 when only materializing workspace", len(scanner.scans))
	}
}

func TestRDPManagedSandboxUploadUsesManagedPayloadContract(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	store := newRecordingObjectStore()
	store.getPayloadOverride = []byte("served-from-object-store")
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	uploadPrefix := stagePrefix("rdp", "tenant-1", "user-1", "conn-1")
	historyPrefix := historyUploadsPrefix("rdp", "tenant-1", "user-1", "conn-1")
	payload := []byte("original-upload-payload")

	transfer, err := svc.uploadManagedRDPFile(ctx, drivePath, workspacePrefix, uploadPrefix, historyPrefix, false, "report.txt", payload)
	if err != nil {
		t.Fatalf("uploadManagedRDPFile failed: %v", err)
	}
	if len(scanner.scans) != 1 {
		t.Fatalf("scanner calls = %d; want 1", len(scanner.scans))
	}
	if len(store.puts) != 2 {
		t.Fatalf("store puts = %d; want 2", len(store.puts))
	}
	if got := store.puts[0].metadata["managed-operation"]; got != string(managedFileOperationUpload) {
		t.Fatalf("managed-operation = %q; want upload", got)
	}
	if got := store.puts[0].metadata["managed-class"]; got != string(managedFileOperationClassPayload) {
		t.Fatalf("managed-class = %q; want payload", got)
	}
	if got := store.puts[0].metadata["audit-correlation-id"]; got != transfer.AuditCorrelationID {
		t.Fatalf("audit-correlation-id = %q; want %q", got, transfer.AuditCorrelationID)
	}
	if got := store.puts[0].metadata["sha256"]; got != payloadSHA256(payload) {
		t.Fatalf("sha256 = %q; want %q", got, payloadSHA256(payload))
	}
	if got := store.puts[1].key; got != stageObjectKey(workspacePrefix, "report.txt") {
		t.Fatalf("cache key = %q; want %q", got, stageObjectKey(workspacePrefix, "report.txt"))
	}
	if len(store.deletedKeys) != 1 || store.deletedKeys[0] != transfer.StageKey {
		t.Fatalf("deleted keys = %#v; want transient stage cleanup for %q", store.deletedKeys, transfer.StageKey)
	}
	materialized, err := os.ReadFile(filepath.Join(drivePath, "report.txt"))
	if err != nil {
		t.Fatalf("read materialized upload: %v", err)
	}
	if string(materialized) != "served-from-object-store" {
		t.Fatalf("materialized payload = %q; want served-from-object-store", materialized)
	}

	audit := buildManagedRDPPayloadAuditDetails(managedRDPRemotePath("report.txt"), "report.txt", int64(len(payload)), transfer)
	if got := audit["protocol"]; got != "rdp" {
		t.Fatalf("protocol = %#v; want rdp", got)
	}
	if got := audit["transferMode"]; got != managedAuditTransferModePayload {
		t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModePayload)
	}
	if got := audit["remotePath"]; got != "/report.txt" {
		t.Fatalf("remotePath = %#v; want /report.txt", got)
	}
	if got := audit["transferId"]; got != transfer.AuditCorrelationID {
		t.Fatalf("transferId = %#v; want %q", got, transfer.AuditCorrelationID)
	}
	if got := audit["checksumSha256"]; got != payloadSHA256(payload) {
		t.Fatalf("checksumSha256 = %#v; want %q", got, payloadSHA256(payload))
	}
	if got := audit["scanResult"]; got != managedAuditScanClean {
		t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanClean)
	}
}

func TestRDPManagedSandboxDownloadScansBeforeDelivery(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	downloadPrefix := stagePrefix("rdp", "tenant-1", "user-1", "conn-1")
	payload := []byte("warm-cache-payload")
	object, err := store.delegate.Put(ctx, stageObjectKey(workspacePrefix, "report.txt"), payload, "text/plain", map[string]string{"mtime-unix": "1700000000"})
	if err != nil {
		t.Fatalf("seed cached file: %v", err)
	}
	targetPath := filepath.Join(drivePath, "report.txt")
	if err := os.WriteFile(targetPath, payload, 0o644); err != nil {
		t.Fatalf("seed drive file: %v", err)
	}
	if err := os.Chtimes(targetPath, object.ModifiedAt, object.ModifiedAt); err != nil {
		t.Fatalf("set drive mtime: %v", err)
	}

	transfer, info, served, err := svc.downloadManagedRDPFile(ctx, drivePath, workspacePrefix, downloadPrefix, "report.txt")
	if err != nil {
		t.Fatalf("downloadManagedRDPFile failed: %v", err)
	}
	if len(scanner.scans) != 1 {
		t.Fatalf("scanner calls = %d; want 1", len(scanner.scans))
	}
	if len(store.puts) != 1 {
		t.Fatalf("store puts = %d; want 1 transient download stage", len(store.puts))
	}
	if got := store.puts[0].metadata["managed-operation"]; got != string(managedFileOperationDownload) {
		t.Fatalf("managed-operation = %q; want download", got)
	}
	if string(served) != string(payload) {
		t.Fatalf("served payload = %q; want %q", served, payload)
	}
	if info.Size != int64(len(payload)) {
		t.Fatalf("download size = %d; want %d", info.Size, len(payload))
	}
	if len(store.deletedKeys) != 1 || store.deletedKeys[0] != transfer.StageKey {
		t.Fatalf("deleted keys = %#v; want transient stage cleanup for %q", store.deletedKeys, transfer.StageKey)
	}

	audit := buildManagedRDPPayloadAuditDetails(managedRDPRemotePath("report.txt"), "report.txt", info.Size, transfer)
	if got := audit["protocol"]; got != "rdp" {
		t.Fatalf("protocol = %#v; want rdp", got)
	}
	if got := audit["transferMode"]; got != managedAuditTransferModePayload {
		t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModePayload)
	}
	if got := audit["remotePath"]; got != "/report.txt" {
		t.Fatalf("remotePath = %#v; want /report.txt", got)
	}
	if got := audit["checksumSha256"]; got != payloadSHA256(payload) {
		t.Fatalf("checksumSha256 = %#v; want %q", got, payloadSHA256(payload))
	}
	if got := audit["scanResult"]; got != managedAuditScanClean {
		t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanClean)
	}
}

func TestRDPManagedSandboxDeleteFailsClosedOnStorageOutage(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	store := newRecordingObjectStore()
	store.deleteErr = errors.New("storage unavailable")
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	payload := []byte("delete-me")
	object, err := store.delegate.Put(ctx, stageObjectKey(workspacePrefix, "report.txt"), payload, "text/plain", map[string]string{"mtime-unix": "1700000000"})
	if err != nil {
		t.Fatalf("seed cached file: %v", err)
	}
	targetPath := filepath.Join(drivePath, "report.txt")
	if err := os.WriteFile(targetPath, payload, 0o644); err != nil {
		t.Fatalf("seed drive file: %v", err)
	}
	if err := os.Chtimes(targetPath, object.ModifiedAt, object.ModifiedAt); err != nil {
		t.Fatalf("set drive mtime: %v", err)
	}

	err = svc.deleteManagedRDPFile(ctx, drivePath, workspacePrefix, "report.txt")
	if err == nil {
		t.Fatal("expected deleteManagedRDPFile to fail")
	}
	if !errors.Is(err, store.deleteErr) {
		t.Fatalf("expected delete error to wrap storage outage, got %v", err)
	}
	if _, statErr := os.Stat(targetPath); statErr != nil {
		t.Fatalf("drive file should remain after failed delete, stat err = %v", statErr)
	}
	if len(store.deletedKeys) != 1 || store.deletedKeys[0] != stageObjectKey(workspacePrefix, "report.txt") {
		t.Fatalf("deleted keys = %#v; want attempted cache delete for %q", store.deletedKeys, stageObjectKey(workspacePrefix, "report.txt"))
	}
}

func TestRDPManagedSandboxDLPHidesDriveSurfaceWhenTransfersDisabled(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	store := newRecordingObjectStore()
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	historyPrefix := historyUploadsPrefix("rdp", "tenant-1", "user-1", "conn-1")
	if _, err := store.delegate.Put(ctx, stageObjectKey(workspacePrefix, "report.txt"), []byte("workspace payload"), "text/plain", map[string]string{"mtime-unix": "1700000000"}); err != nil {
		t.Fatalf("seed workspace object: %v", err)
	}
	if _, err := store.delegate.Put(ctx, historyObjectKey(historyPrefix, "report.txt", transferTestTime()), []byte("history payload"), "text/plain", map[string]string{"managed-namespace": "history/uploads"}); err != nil {
		t.Fatalf("seed history object: %v", err)
	}
	if err := os.WriteFile(filepath.Join(drivePath, "report.txt"), []byte("stale drive payload"), 0o644); err != nil {
		t.Fatalf("seed drive file: %v", err)
	}

	files, err := svc.listVisibleManagedRDPFiles(ctx, drivePath, workspacePrefix, resolvedFilePolicy{DisableUpload: true, DisableDownload: true})
	if err != nil {
		t.Fatalf("listVisibleManagedRDPFiles failed: %v", err)
	}
	if len(files) != 0 {
		t.Fatalf("len(files) = %d; want 0 when drive surface is hidden", len(files))
	}
	if len(store.getKeys) != 0 {
		t.Fatalf("store gets = %#v; want none when drive surface is hidden", store.getKeys)
	}
	if len(store.puts) != 0 {
		t.Fatalf("store puts = %#v; want none when drive surface is hidden", store.puts)
	}
}

func TestRDPManagedSandboxDLPFailsClosedWithoutStore(t *testing.T) {
	ctx := context.Background()
	drivePath := t.TempDir()
	svc := Service{Scanner: &recordingThreatScanner{}}

	reportPath := filepath.Join(drivePath, "report.txt")
	if err := os.WriteFile(reportPath, []byte("existing report"), 0o644); err != nil {
		t.Fatalf("seed drive file: %v", err)
	}
	if err := os.Chtimes(reportPath, time.Unix(1700000000, 0).UTC(), time.Unix(1700000000, 0).UTC()); err != nil {
		t.Fatalf("set drive mtime: %v", err)
	}

	workspacePrefix := workspaceCurrentPrefix("rdp", "tenant-1", "user-1", "conn-1")
	uploadPrefix := stagePrefix("rdp", "tenant-1", "user-1", "conn-1")
	historyPrefix := historyUploadsPrefix("rdp", "tenant-1", "user-1", "conn-1")
	downloadPrefix := stagePrefix("rdp", "tenant-1", "user-1", "conn-1")

	if _, err := svc.listManagedRDPFiles(ctx, drivePath, workspacePrefix); !errors.Is(err, ErrSharedFilesStorageUnavailable) {
		t.Fatalf("listManagedRDPFiles error = %v; want storage unavailable", err)
	}
	if _, err := svc.uploadManagedRDPFile(ctx, drivePath, workspacePrefix, uploadPrefix, historyPrefix, false, "upload.txt", []byte("hello upload")); !errors.Is(err, ErrSharedFilesStorageUnavailable) {
		t.Fatalf("uploadManagedRDPFile error = %v; want storage unavailable", err)
	}
	if _, statErr := os.Stat(filepath.Join(drivePath, "upload.txt")); !errors.Is(statErr, os.ErrNotExist) {
		t.Fatalf("upload should not materialize file, stat err = %v", statErr)
	}
	if _, _, _, err := svc.downloadManagedRDPFile(ctx, drivePath, workspacePrefix, downloadPrefix, "report.txt"); !errors.Is(err, ErrSharedFilesStorageUnavailable) {
		t.Fatalf("downloadManagedRDPFile error = %v; want storage unavailable", err)
	}
	if err := svc.deleteManagedRDPFile(ctx, drivePath, workspacePrefix, "report.txt"); !errors.Is(err, ErrSharedFilesStorageUnavailable) {
		t.Fatalf("deleteManagedRDPFile error = %v; want storage unavailable", err)
	}
	if _, statErr := os.Stat(reportPath); statErr != nil {
		t.Fatalf("delete should fail closed and keep local file, stat err = %v", statErr)
	}
}
