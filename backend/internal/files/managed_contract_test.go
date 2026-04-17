package files

import (
	"context"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestManagedFileContractMatrix(t *testing.T) {
	expected := map[managedFileOperation]managedFileOperationContract{
		managedFileOperationUpload: {
			Operation:                managedFileOperationUpload,
			Class:                    managedFileOperationClassPayload,
			ManagedViaREST:           true,
			AllowsDirectClientSFTP:   false,
			RequiresObjectStore:      true,
			RequiresThreatScan:       true,
			RequiresAuditLog:         true,
			RequiresAuditCorrelation: true,
		},
		managedFileOperationDownload: {
			Operation:                managedFileOperationDownload,
			Class:                    managedFileOperationClassPayload,
			ManagedViaREST:           true,
			AllowsDirectClientSFTP:   false,
			RequiresObjectStore:      true,
			RequiresThreatScan:       true,
			RequiresAuditLog:         true,
			RequiresAuditCorrelation: true,
		},
		managedFileOperationList: {
			Operation:              managedFileOperationList,
			Class:                  managedFileOperationClassMetadata,
			ManagedViaREST:         true,
			AllowsDirectClientSFTP: false,
			RequiresAuditLog:       true,
		},
		managedFileOperationMkdir: {
			Operation:              managedFileOperationMkdir,
			Class:                  managedFileOperationClassMetadata,
			ManagedViaREST:         true,
			AllowsDirectClientSFTP: false,
			RequiresAuditLog:       true,
		},
		managedFileOperationDelete: {
			Operation:              managedFileOperationDelete,
			Class:                  managedFileOperationClassMetadata,
			ManagedViaREST:         true,
			AllowsDirectClientSFTP: false,
			RequiresAuditLog:       true,
		},
		managedFileOperationRename: {
			Operation:              managedFileOperationRename,
			Class:                  managedFileOperationClassMetadata,
			ManagedViaREST:         true,
			AllowsDirectClientSFTP: false,
			RequiresAuditLog:       true,
		},
	}

	contracts := managedFileContracts()
	if len(contracts) != len(expected) {
		t.Fatalf("expected %d contracts, got %d", len(expected), len(contracts))
	}
	for _, contract := range contracts {
		want, ok := expected[contract.Operation]
		if !ok {
			t.Fatalf("unexpected contract for operation %q", contract.Operation)
		}
		if contract != want {
			t.Fatalf("unexpected contract for %q: %#v", contract.Operation, contract)
		}
	}
}

func TestManagedPayloadRequiresObjectStore(t *testing.T) {
	ctx := context.Background()

	uploadScanner := &recordingThreatScanner{}
	uploadRemoteCalls := 0
	_, err := executeManagedPayloadUpload(ctx, managedFileDependencies{Scanner: uploadScanner}, managedPayloadStageRequest{
		StagePrefix: stagePrefix("ssh-upload", "tenant-1", "user-1", "conn-1"),
		FileName:    "report.txt",
		Payload:     []byte("hello"),
	}, func([]byte) error {
		uploadRemoteCalls++
		return nil
	})
	if !errors.Is(err, errManagedPayloadRequiresObjectStore) {
		t.Fatalf("expected object store requirement error, got %v", err)
	}
	if uploadRemoteCalls != 0 {
		t.Fatalf("expected upload remote write to be skipped, got %d call(s)", uploadRemoteCalls)
	}
	if len(uploadScanner.scans) != 0 {
		t.Fatalf("expected upload scanner to be skipped, got %d call(s)", len(uploadScanner.scans))
	}

	downloadScanner := &recordingThreatScanner{}
	downloadRemoteCalls := 0
	_, err = executeManagedPayloadDownload(ctx, managedFileDependencies{Scanner: downloadScanner}, stagePrefix("ssh-download", "tenant-1", "user-1", "conn-1"), func() (managedRemotePayload, error) {
		downloadRemoteCalls++
		return managedRemotePayload{FileName: "report.txt", Payload: []byte("hello")}, nil
	})
	if !errors.Is(err, errManagedPayloadRequiresObjectStore) {
		t.Fatalf("expected object store requirement error, got %v", err)
	}
	if downloadRemoteCalls != 0 {
		t.Fatalf("expected download remote read to be skipped, got %d call(s)", downloadRemoteCalls)
	}
	if len(downloadScanner.scans) != 0 {
		t.Fatalf("expected download scanner to be skipped, got %d call(s)", len(downloadScanner.scans))
	}
}

func TestManagedPayloadStagesScannerAndAuditCorrelation(t *testing.T) {
	ctx := context.Background()

	t.Run("upload", func(t *testing.T) {
		store := newRecordingObjectStore()
		scanner := &recordingThreatScanner{}
		remote := &fakeSSHRemoteClient{}

		transfer, err := executeManagedPayloadUpload(ctx, managedFileDependencies{Store: store, Scanner: scanner}, managedPayloadStageRequest{
			StagePrefix: stagePrefix("ssh-upload", "tenant-1", "user-1", "conn-1"),
			FileName:    "report.txt",
			Payload:     []byte("hello upload"),
			Metadata: map[string]string{
				"remote-path": "/tmp/report.txt",
			},
		}, func(payload []byte) error {
			writer, err := remote.Create("/tmp/report.txt")
			if err != nil {
				return err
			}
			defer writer.Close()
			_, err = writer.Write(payload)
			return err
		})
		if err != nil {
			t.Fatalf("expected upload staging to succeed, got %v", err)
		}
		if len(scanner.scans) != 1 {
			t.Fatalf("expected one scanner call, got %d", len(scanner.scans))
		}
		if len(store.puts) != 1 {
			t.Fatalf("expected one staged object, got %d", len(store.puts))
		}
		if len(remote.createPaths) != 1 || remote.createPaths[0] != "/tmp/report.txt" {
			t.Fatalf("expected one remote create for /tmp/report.txt, got %#v", remote.createPaths)
		}
		if remote.createBuffer.String() != "hello upload" {
			t.Fatalf("expected remote write payload to match, got %q", remote.createBuffer.String())
		}
		if transfer.AuditCorrelationID == "" {
			t.Fatal("expected audit correlation id to be populated")
		}
		if transfer.Contract.Operation != managedFileOperationUpload {
			t.Fatalf("expected upload contract, got %q", transfer.Contract.Operation)
		}
		if !strings.HasPrefix(transfer.StageKey, stagePrefix("ssh-upload", "tenant-1", "user-1", "conn-1")+"/") {
			t.Fatalf("expected upload stage key to use managed prefix, got %q", transfer.StageKey)
		}
		if got := store.puts[0].metadata["managed-operation"]; got != string(managedFileOperationUpload) {
			t.Fatalf("expected managed-operation=upload, got %q", got)
		}
		if got := store.puts[0].metadata["managed-class"]; got != string(managedFileOperationClassPayload) {
			t.Fatalf("expected managed-class=payload, got %q", got)
		}
		if got := store.puts[0].metadata["managed-rest"]; got != "true" {
			t.Fatalf("expected managed-rest metadata, got %q", got)
		}
		if got := store.puts[0].metadata["audit-correlation-id"]; got != transfer.AuditCorrelationID {
			t.Fatalf("expected audit correlation metadata to match result, got %q", got)
		}
		if got := store.puts[0].metadata["sha256"]; got != payloadSHA256([]byte("hello upload")) {
			t.Fatalf("expected upload sha256 metadata, got %q", got)
		}
	})

	t.Run("download", func(t *testing.T) {
		store := newRecordingObjectStore()
		scanner := &recordingThreatScanner{}
		remote := &fakeSSHRemoteClient{openPayload: []byte("hello download")}

		transfer, err := executeManagedPayloadDownload(ctx, managedFileDependencies{Store: store, Scanner: scanner}, stagePrefix("ssh-download", "tenant-1", "user-1", "conn-1"), func() (managedRemotePayload, error) {
			reader, err := remote.Open("/tmp/report.txt")
			if err != nil {
				return managedRemotePayload{}, err
			}
			defer reader.Close()

			payload, err := io.ReadAll(reader)
			if err != nil {
				return managedRemotePayload{}, err
			}
			return managedRemotePayload{
				FileName: "report.txt",
				Payload:  payload,
				Metadata: map[string]string{"remote-path": "/tmp/report.txt"},
			}, nil
		})
		if err != nil {
			t.Fatalf("expected download staging to succeed, got %v", err)
		}
		if len(scanner.scans) != 1 {
			t.Fatalf("expected one scanner call, got %d", len(scanner.scans))
		}
		if len(store.puts) != 1 {
			t.Fatalf("expected one staged object, got %d", len(store.puts))
		}
		if len(remote.openPaths) != 1 || remote.openPaths[0] != "/tmp/report.txt" {
			t.Fatalf("expected one remote open for /tmp/report.txt, got %#v", remote.openPaths)
		}
		if string(transfer.Payload) != "hello download" {
			t.Fatalf("expected download payload to round-trip, got %q", string(transfer.Payload))
		}
		if transfer.AuditCorrelationID == "" {
			t.Fatal("expected audit correlation id to be populated")
		}
		if transfer.Contract.Operation != managedFileOperationDownload {
			t.Fatalf("expected download contract, got %q", transfer.Contract.Operation)
		}
		if !strings.HasPrefix(transfer.StageKey, stagePrefix("ssh-download", "tenant-1", "user-1", "conn-1")+"/") {
			t.Fatalf("expected download stage key to use managed prefix, got %q", transfer.StageKey)
		}
		if got := store.puts[0].metadata["managed-operation"]; got != string(managedFileOperationDownload) {
			t.Fatalf("expected managed-operation=download, got %q", got)
		}
		if got := store.puts[0].metadata["audit-correlation-id"]; got != transfer.AuditCorrelationID {
			t.Fatalf("expected audit correlation metadata to match result, got %q", got)
		}
		if got := store.puts[0].metadata["sha256"]; got != payloadSHA256([]byte("hello download")) {
			t.Fatalf("expected download sha256 metadata, got %q", got)
		}
	})
}

func TestManagedMetadataUsesRemoteOperations(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	service := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)

	t.Run("list", func(t *testing.T) {
		if err := service.putSSHWorkspaceDirectory(ctx, workspacePrefix, "workspace"); err != nil {
			t.Fatalf("putSSHWorkspaceDirectory failed: %v", err)
		}
		if _, err := service.writeSSHWorkspaceFile(ctx, workspacePrefix, "workspace/notes.txt", []byte("hello notes"), map[string]string{"remote-path": "/workspace/notes.txt"}); err != nil {
			t.Fatalf("writeSSHWorkspaceFile failed: %v", err)
		}
		entries, err := service.listSSHEntries(ctx, scope, "workspace")
		if err != nil {
			t.Fatalf("expected list to succeed, got %v", err)
		}
		if len(entries) != 1 || entries[0].Type != "file" || entries[0].Name != "notes.txt" {
			t.Fatalf("expected sandbox metadata entries, got %#v", entries)
		}
	})

	t.Run("mkdir", func(t *testing.T) {
		remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
		if err := service.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
			t.Fatalf("expected mkdir to succeed, got %v", err)
		}
		if !containsString(remote.mkdirPaths, path.Join(sshWorkspaceMirrorRootPath(remote.workingDir, scope), "docs")) {
			t.Fatalf("expected sandbox mkdir, got %#v", remote.mkdirPaths)
		}
	})

	t.Run("delete file", func(t *testing.T) {
		remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
		if _, err := service.writeSSHWorkspaceFile(ctx, workspacePrefix, "docs/notes.txt", []byte("delete me"), map[string]string{"remote-path": "/docs/notes.txt"}); err != nil {
			t.Fatalf("seed sandbox file: %v", err)
		}
		if err := service.materializeSSHWorkspaceFile(ctx, remote, scope, workspacePrefix, "docs/notes.txt"); err != nil {
			t.Fatalf("materializeSSHWorkspaceFile failed: %v", err)
		}
		if err := service.deleteSSHPath(ctx, remote, scope, "docs/notes.txt"); err != nil {
			t.Fatalf("expected delete file to succeed, got %v", err)
		}
		if len(remote.removePaths) == 0 {
			t.Fatal("expected mirrored file delete")
		}
	})

	t.Run("delete directory", func(t *testing.T) {
		remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
		if err := service.putSSHWorkspaceDirectory(ctx, workspacePrefix, "workspace-nested"); err != nil {
			t.Fatalf("seed sandbox directory: %v", err)
		}
		if err := service.materializeSSHDirectory(remote, scope, "workspace-nested"); err != nil {
			t.Fatalf("materializeSSHDirectory failed: %v", err)
		}
		if err := service.deleteSSHPath(ctx, remote, scope, "workspace-nested"); err != nil {
			t.Fatalf("expected delete directory to succeed, got %v", err)
		}
		if len(remote.removeDirectoryPaths) == 0 {
			t.Fatal("expected mirrored directory delete")
		}
	})

	t.Run("rename", func(t *testing.T) {
		remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
		if _, err := service.writeSSHWorkspaceFile(ctx, workspacePrefix, "rename-old.txt", []byte("rename me"), map[string]string{"remote-path": "/rename-old.txt"}); err != nil {
			t.Fatalf("seed sandbox file: %v", err)
		}
		if err := service.materializeSSHWorkspaceFile(ctx, remote, scope, workspacePrefix, "rename-old.txt"); err != nil {
			t.Fatalf("materializeSSHWorkspaceFile failed: %v", err)
		}
		if err := service.renameSSHPath(ctx, remote, scope, "rename-old.txt", "rename-new.txt"); err != nil {
			t.Fatalf("expected rename to succeed, got %v", err)
		}
		if len(remote.renameCalls) == 0 {
			t.Fatal("expected mirrored rename materialization")
		}
	})
}

func TestManagedHistory(t *testing.T) {
	t.Run("rdp retained upload list download restore delete", func(t *testing.T) {
		ctx := context.Background()
		store := newRecordingObjectStore()
		svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
		drivePath := t.TempDir()
		scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")
		workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		stagePrefix := stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		historyPrefix := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)

		if _, err := svc.uploadManagedRDPFile(ctx, drivePath, workspacePrefix, stagePrefix, historyPrefix, true, "report.txt", []byte("hello history")); err != nil {
			t.Fatalf("uploadManagedRDPFile failed: %v", err)
		}

		history, err := svc.listManagedHistory(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("listManagedHistory failed: %v", err)
		}
		if len(history) != 1 {
			t.Fatalf("history items = %d; want 1", len(history))
		}
		entry := history[0]
		if entry.FileName != "report.txt" {
			t.Fatalf("history fileName = %q; want report.txt", entry.FileName)
		}
		if entry.Protocol != "rdp" {
			t.Fatalf("history protocol = %q; want rdp", entry.Protocol)
		}
		if entry.ID == "" {
			t.Fatal("expected history id")
		}

		files, err := svc.listManagedRDPFiles(ctx, drivePath, workspacePrefix)
		if err != nil {
			t.Fatalf("listManagedRDPFiles failed: %v", err)
		}
		if len(files) != 1 || files[0].Name != "report.txt" {
			t.Fatalf("workspace files = %#v; want only report.txt", files)
		}

		downloadedEntry, downloadTransfer, _, served, err := svc.downloadManagedHistory(ctx, historyPrefix, stagePrefix, entry.ID, resolvedFilePolicy{})
		if err != nil {
			t.Fatalf("downloadManagedHistory failed: %v", err)
		}
		if downloadedEntry.ID != entry.ID {
			t.Fatalf("downloaded history id = %q; want %q", downloadedEntry.ID, entry.ID)
		}
		if string(served) != "hello history" {
			t.Fatalf("served payload = %q; want hello history", string(served))
		}
		downloadAudit := buildManagedRDPPayloadAuditDetails(managedHistoryDisplayPath(entry.FileName), entry.FileName, int64(len(served)), downloadTransfer)
		if got := downloadAudit["history"]; got != managedAuditDispositionRead {
			t.Fatalf("download history disposition = %#v; want %q", got, managedAuditDispositionRead)
		}
		if got := downloadAudit["workspace"]; got != managedAuditDispositionNA {
			t.Fatalf("download workspace disposition = %#v; want %q", got, managedAuditDispositionNA)
		}

		restoredEntry, restoreTransfer, err := svc.restoreManagedRDPHistory(ctx, drivePath, workspacePrefix, stagePrefix, historyPrefix, entry.ID, "restored.txt")
		if err != nil {
			t.Fatalf("restoreManagedRDPHistory failed: %v", err)
		}
		if restoredEntry.RestoredName != "restored.txt" {
			t.Fatalf("restored name = %q; want restored.txt", restoredEntry.RestoredName)
		}
		restoredPayload, err := os.ReadFile(filepath.Join(drivePath, "restored.txt"))
		if err != nil {
			t.Fatalf("read restored drive file: %v", err)
		}
		if string(restoredPayload) != "hello history" {
			t.Fatalf("restored payload = %q; want hello history", string(restoredPayload))
		}
		restoreAudit := buildManagedRDPPayloadAuditDetails(managedRDPRemotePath(restoredEntry.RestoredName), restoredEntry.FileName, int64(len(restoreTransfer.Payload)), restoreTransfer)
		if got := restoreAudit["workspace"]; got != managedAuditDispositionMaterialized {
			t.Fatalf("restore workspace disposition = %#v; want %q", got, managedAuditDispositionMaterialized)
		}
		if got := restoreAudit["history"]; got != managedAuditDispositionRead {
			t.Fatalf("restore history disposition = %#v; want %q", got, managedAuditDispositionRead)
		}
		if got := restoreAudit["restore"]; got != managedAuditDispositionApplied {
			t.Fatalf("restore disposition = %#v; want %q", got, managedAuditDispositionApplied)
		}

		updatedHistory, err := svc.listManagedHistory(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("listManagedHistory after restore failed: %v", err)
		}
		if len(updatedHistory) != 1 || updatedHistory[0].RestoredName != "restored.txt" {
			t.Fatalf("updated history = %#v; want restored name recorded", updatedHistory)
		}

		deletedEntry, err := svc.deleteManagedHistory(ctx, historyPrefix, entry.ID)
		if err != nil {
			t.Fatalf("deleteManagedHistory failed: %v", err)
		}
		if deletedEntry.ID != entry.ID {
			t.Fatalf("deleted history id = %q; want %q", deletedEntry.ID, entry.ID)
		}
		remaining, err := svc.listManagedHistory(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("listManagedHistory after delete failed: %v", err)
		}
		if len(remaining) != 0 {
			t.Fatalf("remaining history items = %d; want 0", len(remaining))
		}
	})

	t.Run("ssh restore materializes sandbox without raw path leakage", func(t *testing.T) {
		ctx := context.Background()
		store := newRecordingObjectStore()
		remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
		svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
		scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
		historyPrefix := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		if err := svc.retainSuccessfulUpload(ctx, historyPrefix, "report.txt", []byte("hello ssh history"), map[string]string{"sha256": payloadSHA256([]byte("hello ssh history")), "audit-correlation-id": "corr-ssh"}, managedHistoryRetentionOptions{Protocol: "ssh", ActorID: "user-1"}); err != nil {
			t.Fatalf("retainSuccessfulUpload failed: %v", err)
		}
		history, err := svc.listManagedHistory(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("listManagedHistory failed: %v", err)
		}
		if len(history) != 1 {
			t.Fatalf("ssh history items = %d; want 1", len(history))
		}
		entry, transfer, err := svc.restoreManagedSSHHistory(ctx, remote, scope, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: scope.ConnectionID}}, history[0].ID, "docs/restored.txt")
		if err != nil {
			t.Fatalf("restoreManagedSSHHistory failed: %v", err)
		}
		mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, scope)
		if len(remote.createPaths) == 0 {
			t.Fatalf("expected ssh restore temp write activity, got create=%#v", remote.createPaths)
		}
		if len(remote.renameCalls) == 0 || remote.renameCalls[len(remote.renameCalls)-1].newPath != path.Join(mirrorRoot, "docs/restored.txt") {
			t.Fatalf("ssh restore rename calls = %#v; want final path %q", remote.renameCalls, path.Join(mirrorRoot, "docs/restored.txt"))
		}
		if _, ok := remote.fs[path.Join(mirrorRoot, "docs/restored.txt")]; !ok {
			t.Fatalf("expected remote sandbox file at %q, got fs keys %#v", path.Join(mirrorRoot, "docs/restored.txt"), remote.fs)
		}
		if got := buildManagedTransferAuditDetails("ssh", sshSandboxDisplayPath(entry.RestoredName), entry.FileName, int64(len(transfer.Payload)), transfer.StageKey, transfer.AuditCorrelationID, transfer.Metadata)["remotePath"]; got != "/docs/restored.txt" {
			t.Fatalf("ssh restore remotePath = %#v; want /docs/restored.txt", got)
		}
	})
}

func TestManagedHistoryRejectsFailedUploads(t *testing.T) {
	t.Run("scanner rejection never becomes history", func(t *testing.T) {
		ctx := context.Background()
		store := newRecordingObjectStore()
		svc := Service{Store: store, Scanner: &recordingThreatScanner{verdict: ScanVerdict{Clean: false, Reason: "blocked by scanner"}}}
		scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")
		historyPrefix := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		_, err := svc.uploadManagedRDPFile(ctx, t.TempDir(), workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID), historyPrefix, true, "blocked.txt", []byte("blocked"))
		if err == nil {
			t.Fatal("expected scanner rejection")
		}
		items, err := svc.listManagedHistory(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("listManagedHistory failed: %v", err)
		}
		if len(items) != 0 {
			t.Fatalf("history items = %d; want 0", len(items))
		}
		denied := buildManagedTransferDeniedAuditDetails("rdp", "blocked.txt", "blocked.txt", "blocked by scanner")
		if got := denied["policyDecision"]; got != managedAuditPolicyDenied {
			t.Fatalf("policyDecision = %#v; want %q", got, managedAuditPolicyDenied)
		}
	})

	t.Run("partial materialization never becomes history", func(t *testing.T) {
		ctx := context.Background()
		store := newRecordingObjectStore()
		store.getErr = errors.New("materialize failed")
		drivePath := t.TempDir()
		svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
		scope := newManagedSandboxScope("rdp", "tenant-1", "user-1", "conn-1")
		workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		stagePrefix := stagePrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		historyPrefix := historyUploadsPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
		_, err := svc.uploadManagedRDPFile(ctx, drivePath, workspacePrefix, stagePrefix, historyPrefix, true, "partial.txt", []byte("partial"))
		if err == nil {
			t.Fatal("expected materialization failure")
		}
		if _, statErr := os.Stat(filepath.Join(drivePath, "partial.txt")); !errors.Is(statErr, os.ErrNotExist) {
			t.Fatalf("drive file stat err = %v; want not exist", statErr)
		}
		workspaceObjects, err := store.delegate.List(ctx, workspacePrefix)
		if err != nil {
			t.Fatalf("list workspace objects: %v", err)
		}
		if len(workspaceObjects) != 0 {
			t.Fatalf("workspace objects = %d; want 0", len(workspaceObjects))
		}
		historyObjects, err := store.delegate.List(ctx, historyPrefix)
		if err != nil {
			t.Fatalf("list history objects: %v", err)
		}
		if len(historyObjects) != 0 {
			t.Fatalf("history objects = %d; want 0", len(historyObjects))
		}
	})
}
