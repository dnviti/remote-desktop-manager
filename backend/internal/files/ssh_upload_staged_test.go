package files

import (
	"bytes"
	"context"
	"errors"
	"path"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestSSHUploadUsesStagedObject(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: scanner}

	payload := []byte("hello from staged object")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

result, err := svc.uploadToSSH(context.Background(), remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", payload)
	if err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
	if len(store.puts) != 2 {
		t.Fatalf("expected 2 puts (stage + workspace), got %d", len(store.puts))
	}
	if !bytes.Equal(store.puts[0].payload, payload) {
		t.Fatalf("staged payload != original: got %q, want %q", store.puts[0].payload, payload)
	}
	if !bytes.Equal(store.puts[1].payload, payload) {
		t.Fatalf("workspace payload != original: got %q, want %q", store.puts[1].payload, payload)
	}

	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1"))
	if len(remote.createPaths) != 1 {
		t.Fatalf("expected 1 create call, got %d", len(remote.createPaths))
	}
	wantTempFile := path.Join(mirrorRoot, "docs", ".report.txt.tmp.")
	if len(remote.createPaths[0]) < len(wantTempFile) || remote.createPaths[0][:len(wantTempFile)] != wantTempFile {
		t.Errorf("create path = %q; want it to start with %q", remote.createPaths[0], wantTempFile)
	}

	if len(remote.renameCalls) != 1 {
		t.Fatalf("expected 1 rename call, got %d", len(remote.renameCalls))
	}
	if remote.renameCalls[0].oldPath != remote.createPaths[0] {
		t.Errorf("rename old path = %q; want %q", remote.renameCalls[0].oldPath, remote.createPaths[0])
	}
	if remote.renameCalls[0].newPath != path.Join(mirrorRoot, "docs", "report.txt") {
		t.Errorf("rename new path = %q; want %q", remote.renameCalls[0].newPath, path.Join(mirrorRoot, "docs", "report.txt"))
	}

	if len(store.deletedKeys) != 1 {
		t.Fatalf("expected 1 stage delete, got %d", len(store.deletedKeys))
	}
	if store.deletedKeys[0] != result.StageKey {
		t.Errorf("deleted key = %q; want %q", store.deletedKeys[0], result.StageKey)
	}
	if !bytes.Equal(remote.createBuffer.Bytes(), payload) {
		t.Errorf("remote write = %q; want %q (staged bytes)", remote.createBuffer.Bytes(), payload)
	}
}

func TestSSHUploadFailsClosedOnDLPDisabled(t *testing.T) {
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Scanner: scanner}

	policy := resolvedFilePolicy{DisableUpload: true}
_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, policy, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("test"))
	if err == nil {
		t.Fatal("expected error for disabled upload")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != 403 {
		t.Errorf("status = %d; want 403", reqErr.status)
	}
	if len(remote.createPaths) != 0 {
		t.Fatalf("expected no remote write when upload disabled, got %#v", remote.createPaths)
	}
}

func TestSSHUploadCleansUpTempFileOnWriteFailure(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops", createWriteErr: errors.New("write failed")}
	svc := Service{Store: store, Scanner: scanner}

_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("test"))
	if err == nil {
		t.Fatal("expected error on write failure")
	}
	if len(remote.removePaths) != 1 {
		t.Fatalf("expected 1 temp-file remove call, got %d", len(remote.removePaths))
	}
	if len(store.deletedKeys) != 2 {
		t.Fatalf("expected workspace rollback + stage cleanup, got %d deletes", len(store.deletedKeys))
	}
	if store.deletedKeys[1] != store.puts[0].key {
		t.Errorf("stage deleted key = %q; want %q", store.deletedKeys[1], store.puts[0].key)
	}
}

func TestSSHUploadCleansUpStagedObjectOnCloseFailure(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops", createCloseErr: errors.New("close failed")}
	svc := Service{Store: store, Scanner: scanner}

_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("test"))
	if err == nil {
		t.Fatal("expected error on close failure")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != 400 {
		t.Errorf("status = %d; want 400", reqErr.status)
	}
	if reqErr.message != "failed to synchronize SSH sandbox" {
		t.Errorf("message = %q; want failed to synchronize SSH sandbox", reqErr.message)
	}
	if len(remote.renameCalls) != 0 {
		t.Fatalf("expected no rename call on close failure, got %d", len(remote.renameCalls))
	}
	if len(store.deletedKeys) != 2 {
		t.Fatalf("expected workspace rollback + stage cleanup, got %d deletes", len(store.deletedKeys))
	}
	if store.deletedKeys[1] != store.puts[0].key {
		t.Errorf("stage deleted key = %q; want %q", store.deletedKeys[1], store.puts[0].key)
	}
}

func TestSSHUploadBlocksEICAR(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{verdict: ScanVerdict{Clean: false, Reason: "malware detected"}}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: scanner}

	eicar := []byte("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "eicar.txt", "docs/eicar.txt", eicar)
	if err == nil {
		t.Fatal("expected error for EICAR file")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != 422 {
		t.Errorf("status = %d; want 422", reqErr.status)
	}
	if len(remote.createPaths) != 0 {
		t.Errorf("expected no remote write for blocked file, got %d", len(remote.createPaths))
	}
	if len(store.deletedKeys) != 0 {
		t.Errorf("expected no staged object deletion for blocked file, got %d", len(store.deletedKeys))
	}
}

func TestSSHUploadStoresPayloadInObjectStore(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: scanner}

	payload := []byte("content to store")
_, _ = svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "doc.txt", "docs/doc.txt", payload)

	if len(store.puts) != 2 {
		t.Fatalf("expected 2 puts, got %d", len(store.puts))
	}
	for i, put := range store.puts {
		if put.key == "" {
			t.Errorf("put %d stored key is empty", i)
		}
		if !bytes.Equal(put.payload, payload) {
			t.Errorf("put %d stored payload = %q; want %q", i, put.payload, payload)
		}
	}
}

func TestSSHUploadRetrievesFromObjectStoreNotOriginalPayload(t *testing.T) {
	store := newRecordingObjectStore()
	store.getPayloadOverride = []byte("from-object-store-not-original")
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: scanner}

_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "file.txt", "docs/file.txt", []byte("original-payload"))
	if err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
	if !bytes.Equal(remote.createBuffer.Bytes(), []byte("from-object-store-not-original")) {
		t.Errorf("remote write = %q; want %q (from object store, not original payload)", remote.createBuffer.Bytes(), "from-object-store-not-original")
	}
}

func TestSSHUploadReplacesExistingMirrorFile(t *testing.T) {
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	remote.ensureBaseFS()
	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1"))
	existingPath := path.Join(mirrorRoot, "docs", "report.txt")
	remote.ensureDir(path.Dir(existingPath))
	remote.fs[normalizeFakeSSHPath(existingPath)] = fakeSSHRemoteEntry{payload: []byte("old payload")}
	remote.renameHook = func(_, newPath string) error {
		if _, ok := remote.fs[normalizeFakeSSHPath(newPath)]; ok {
			return fakeSSHError("target exists")
		}
		return nil
	}
	svc := Service{Store: store, Scanner: scanner}

_, err := svc.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("new payload"))
	if err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
	if len(remote.removePaths) == 0 || normalizeFakeSSHPath(remote.removePaths[0]) != normalizeFakeSSHPath(existingPath) {
		t.Fatalf("remove paths = %#v; want existing target %q removed before rename", remote.removePaths, existingPath)
	}
	entry, ok := remote.fs[normalizeFakeSSHPath(existingPath)]
	if !ok {
		t.Fatalf("expected mirrored file at %q", existingPath)
	}
	if !bytes.Equal(entry.payload, []byte("new payload")) {
		t.Fatalf("mirror payload = %q; want %q", entry.payload, []byte("new payload"))
	}
	if len(remote.renameCalls) != 1 {
		t.Fatalf("expected 1 rename call, got %d", len(remote.renameCalls))
	}
}
