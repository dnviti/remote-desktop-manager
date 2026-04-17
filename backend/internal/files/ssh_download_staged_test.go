package files

import (
	"bytes"
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestSSHDownloadReturnsStagedObject(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	store.getPayloadOverride = []byte("served-from-object-store")
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}
	workspacePrefix := workspaceCurrentPrefix("ssh", "tenant-1", "user-1", "conn-1")
	if _, err := store.delegate.Put(ctx, sshWorkspaceFileKey(workspacePrefix, "docs/report.txt"), []byte("original-workspace-payload"), "text/plain", map[string]string{"managed-namespace": "workspace/current"}); err != nil {
		t.Fatalf("seed workspace file: %v", err)
	}

download, err := svc.downloadFromSSH(ctx, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "docs/report.txt")
	if err != nil {
		t.Fatalf("downloadFromSSH failed: %v", err)
	}

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/ssh/download", nil)
	svc.writeSSHDownloadResponse(recorder, req, download)

	if !bytes.Equal(recorder.Body.Bytes(), []byte("served-from-object-store")) {
		t.Fatalf("response body = %q; want staged object bytes", recorder.Body.Bytes())
	}
	if len(store.getKeys) == 0 || store.getKeys[0] != sshWorkspaceFileKey(workspacePrefix, "docs/report.txt") {
		t.Fatalf("expected first objectStore.Get(%q), got %#v", sshWorkspaceFileKey(workspacePrefix, "docs/report.txt"), store.getKeys)
	}
	if got := recorder.Header().Get("Content-Disposition"); got != `attachment; filename="report.txt"` {
		t.Fatalf("content disposition = %q", got)
	}
	if got := recorder.Header().Get("Content-Type"); got == "" {
		t.Fatal("expected content type header to be set")
	}
}

func TestSSHDownloadFailsClosed(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	store.getErr = errors.New("storage unavailable")
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}

_, err := svc.downloadFromSSH(ctx, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "docs/report.txt")
	if err == nil {
		t.Fatal("expected workspace read failure")
	}
	if len(store.deletedKeys) != 0 {
		t.Fatalf("expected no staged delete before staging, got %d", len(store.deletedKeys))
	}
	if len(store.getKeys) != 1 {
		t.Fatalf("expected one workspace get attempt, got %d", len(store.getKeys))
	}
}

func TestSSHDownloadBlocksEICAR(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{verdict: ScanVerdict{Clean: false, Reason: "malware detected"}}
	svc := Service{Store: store, Scanner: scanner}
	workspacePrefix := workspaceCurrentPrefix("ssh", "tenant-1", "user-1", "conn-1")
	if _, err := store.delegate.Put(ctx, sshWorkspaceFileKey(workspacePrefix, "docs/eicar.txt"), []byte(eicarSignature), "text/plain", map[string]string{"managed-namespace": "workspace/current"}); err != nil {
		t.Fatalf("seed workspace file: %v", err)
	}

_, err := svc.downloadFromSSH(ctx, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "docs/eicar.txt")
	if err == nil {
		t.Fatal("expected error for EICAR download")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != 422 {
		t.Fatalf("status = %d; want 422", reqErr.status)
	}
	if len(store.puts) != 0 {
		t.Fatalf("expected blocked download to avoid staging, got %d put(s)", len(store.puts))
	}
	if len(store.deletedKeys) != 0 {
		t.Fatalf("expected no staged deletes when staging never happened, got %d", len(store.deletedKeys))
	}
}

func TestSSHDownloadCleansUpStage(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	scanner := &recordingThreatScanner{}
	svc := Service{Store: store, Scanner: scanner}
	workspacePrefix := workspaceCurrentPrefix("ssh", "tenant-1", "user-1", "conn-1")
	if _, err := store.delegate.Put(ctx, sshWorkspaceFileKey(workspacePrefix, "docs/report.txt"), []byte("cleanup me"), "text/plain", map[string]string{"managed-namespace": "workspace/current"}); err != nil {
		t.Fatalf("seed workspace file: %v", err)
	}

download, err := svc.downloadFromSSH(ctx, sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "docs/report.txt")
	if err != nil {
		t.Fatalf("downloadFromSSH failed: %v", err)
	}

	recorder := httptest.NewRecorder()
	req := httptest.NewRequest("POST", "/api/files/ssh/download", nil)
	svc.writeSSHDownloadResponse(recorder, req, download)

	if len(store.deletedKeys) != 1 {
		t.Fatalf("expected staged object delete after response, got %d", len(store.deletedKeys))
	}
	if store.deletedKeys[0] != download.StageKey {
		t.Fatalf("deleted key = %q; want %q", store.deletedKeys[0], download.StageKey)
	}
	if recorder.Body.String() != "cleanup me" {
		t.Fatalf("response body = %q; want cleanup me", recorder.Body.String())
	}
}
