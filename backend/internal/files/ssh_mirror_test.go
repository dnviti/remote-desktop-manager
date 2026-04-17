package files

import (
	"context"
	"path"
	"strings"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestSSHWorkspaceMirrorPathNormalizesWindowsHomeDir(t *testing.T) {
	got := SSHWorkspaceMirrorPath(`C:\Users\acceptance`, "tenant-1", "user-1", "conn-1")
	want := "C:/Users/acceptance/.arsenale-transfer/tenant-1/user-1/conn-1/workspace"
	if got != want {
		t.Fatalf("SSHWorkspaceMirrorPath() = %q; want %q", got, want)
	}
}

func TestSSHWorkspaceMirrorPathUsesReadableSegments(t *testing.T) {
	got := SSHWorkspaceMirrorPath("/home/root", "Development Environment", "admin@example.com", "smarthome-services")
	want := "/home/root/.arsenale-transfer/development-environment/admin-example-com/smarthome-services/workspace"
	if got != want {
		t.Fatalf("SSHWorkspaceMirrorPath() = %q; want %q", got, want)
	}
}

func TestSSHWorkspaceMirrorPathForScopeUsesReadableHashedSegments(t *testing.T) {
	scope := newManagedSandboxScopeWithLabels("ssh", "tenant-uuid-1", "user-uuid-1", "conn-uuid-1", "Development Environment", "admin@example.com", "smarthome-services")
	got := sshWorkspaceMirrorPathForScope("/home/root", scope)
	if !strings.Contains(got, "/.arsenale-transfer/development-environment--") {
		t.Fatalf("expected readable tenant segment with hash suffix, got %q", got)
	}
	if !strings.Contains(got, "/admin-example-com--") {
		t.Fatalf("expected readable user segment with hash suffix, got %q", got)
	}
	if !strings.Contains(got, "/smarthome-services--") {
		t.Fatalf("expected readable connection segment with hash suffix, got %q", got)
	}
	if strings.Contains(got, "tenant-uuid-1") || strings.Contains(got, "user-uuid-1") || strings.Contains(got, "conn-uuid-1") {
		t.Fatalf("expected no raw ids in visible path, got %q", got)
	}
}

func TestEnsureSSHMirrorDirectoryHandlesWindowsDrivePaths(t *testing.T) {
	remote := &fakeSSHRemoteClient{workingDir: `C:\Users\acceptance`}
	target := SSHWorkspaceMirrorPath(`C:\Users\acceptance`, "tenant-1", "user-1", "conn-1")

	if err := ensureSSHMirrorDirectory(remote, path.Join(target, "docs")); err != nil {
		t.Fatalf("ensureSSHMirrorDirectory failed: %v", err)
	}

	for _, want := range []string{
		"C:/Users/acceptance/.arsenale-transfer",
		"C:/Users/acceptance/.arsenale-transfer/tenant-1/user-1/conn-1/workspace/docs",
	} {
		if !containsString(remote.mkdirPaths, want) {
			t.Fatalf("mkdir paths = %#v; want %q", remote.mkdirPaths, want)
		}
	}
	if containsString(remote.mkdirPaths, "/C:") {
		t.Fatalf("mkdir paths should not use malformed drive roots: %#v", remote.mkdirPaths)
	}
}

func TestSSHCreateDirectoryFallsBackToWritableTempMirror(t *testing.T) {
	ctx := context.Background()
	remote := &fakeSSHRemoteClient{workingDir: "/home/acceptance"}
	remote.mkdirHook = func(path string) error {
		if strings.HasPrefix(normalizeFakeSSHPath(path), "/home/acceptance/.arsenale-transfer") {
			return fakeSSHError("read-only file system")
		}
		return nil
	}
	svc := Service{Store: newRecordingObjectStore(), Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")

	if err := svc.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("createSSHDirectory failed: %v", err)
	}

	fallbackRoot := sshWorkspaceMirrorPathForScope("/tmp", scope)
	if !containsString(remote.mkdirPaths, path.Join(fallbackRoot, "docs")) {
		t.Fatalf("mkdir paths = %#v; want fallback under %q", remote.mkdirPaths, path.Join(fallbackRoot, "docs"))
	}
}

func TestSSHUploadFallsBackToWritableTempMirror(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	remote := &fakeSSHRemoteClient{workingDir: "/home/acceptance"}
	remote.mkdirHook = func(path string) error {
		if strings.HasPrefix(normalizeFakeSSHPath(path), "/home/acceptance/.arsenale-transfer") {
			return fakeSSHError("read-only file system")
		}
		return nil
	}
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

if _, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("payload")); err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}

	fallbackScope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	fallbackRoot := sshWorkspaceMirrorPathForScope("/tmp", fallbackScope)
	wantTempPrefix := path.Join(fallbackRoot, "docs", ".report.txt.tmp.")
	if len(remote.createPaths) == 0 || !strings.HasPrefix(remote.createPaths[0], wantTempPrefix) {
		t.Fatalf("create paths = %#v; want fallback temp prefix %q", remote.createPaths, wantTempPrefix)
	}
}
