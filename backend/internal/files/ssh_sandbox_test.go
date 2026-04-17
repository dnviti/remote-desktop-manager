package files

import (
	"context"
	"errors"
	"io"
	"path"
	"strings"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestSSHSandbox(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	store.getPayloadOverride = []byte("served-from-workspace-object")
	scanner := &recordingThreatScanner{}
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: scanner}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

	if err := svc.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("createSSHDirectory failed: %v", err)
	}

upload, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "ignored-local-name.txt", "docs/report.txt", []byte("original-upload-payload"))
	if err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
	if upload.StageKey == "" {
		t.Fatal("expected upload stage key")
	}

	remote.readDirPaths = nil
	rootEntries, err := svc.listSSHEntries(ctx, scope, ".")
	if err != nil {
		t.Fatalf("listSSHEntries root failed: %v", err)
	}
	if len(remote.readDirPaths) != 0 {
		t.Fatalf("listSSHEntries should not browse remote filesystem, got %#v", remote.readDirPaths)
	}
	if len(rootEntries) != 1 || rootEntries[0].Name != "docs" || rootEntries[0].Type != "directory" {
		t.Fatalf("root entries = %#v; want docs directory only", rootEntries)
	}

	docsEntries, err := svc.listSSHEntries(ctx, scope, "docs")
	if err != nil {
		t.Fatalf("listSSHEntries docs failed: %v", err)
	}
	if len(docsEntries) != 1 || docsEntries[0].Name != "report.txt" || docsEntries[0].Type != "file" {
		t.Fatalf("docs entries = %#v; want report.txt file only", docsEntries)
	}

download, err := svc.downloadFromSSH(ctx, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "docs/report.txt")
	if err != nil {
		t.Fatalf("downloadFromSSH failed: %v", err)
	}
	served, err := io.ReadAll(download.Reader)
	if err != nil {
		t.Fatalf("read download reader: %v", err)
	}
	download.Cleanup()
	if string(served) != "served-from-workspace-object" {
		t.Fatalf("download payload = %q; want served-from-workspace-object", served)
	}
	if len(remote.openPaths) != 0 {
		t.Fatalf("download should not read the remote filesystem, got %#v", remote.openPaths)
	}

	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, scope)
	if !containsString(remote.mkdirPaths, mirrorRoot) {
		t.Fatalf("expected mirror root mkdir under %q, got %#v", mirrorRoot, remote.mkdirPaths)
	}
	if !containsString(remote.mkdirPaths, path.Join(mirrorRoot, "docs")) {
		t.Fatalf("expected docs mkdir under %q, got %#v", mirrorRoot, remote.mkdirPaths)
	}
	if len(remote.createPaths) == 0 || !strings.HasPrefix(remote.createPaths[0], path.Join(mirrorRoot, "docs", ".report.txt.tmp.")) {
		t.Fatalf("create paths = %#v; want temp file under sandbox mirror root", remote.createPaths)
	}
	if len(remote.renameCalls) == 0 || remote.renameCalls[0].newPath != path.Join(mirrorRoot, "docs", "report.txt") {
		t.Fatalf("rename calls = %#v; want sandbox mirror destination", remote.renameCalls)
	}

	if err := svc.renameSSHPath(ctx, remote, scope, "docs/report.txt", "docs/final.txt"); err != nil {
		t.Fatalf("renameSSHPath failed: %v", err)
	}
	renamedEntries, err := svc.listSSHEntries(ctx, scope, "docs")
	if err != nil {
		t.Fatalf("listSSHEntries after rename failed: %v", err)
	}
	if len(renamedEntries) != 1 || renamedEntries[0].Name != "final.txt" {
		t.Fatalf("renamed entries = %#v; want final.txt", renamedEntries)
	}

	if err := svc.deleteSSHPath(ctx, remote, scope, "docs/final.txt"); err != nil {
		t.Fatalf("deleteSSHPath file failed: %v", err)
	}
	if err := svc.deleteSSHPath(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("deleteSSHPath directory failed: %v", err)
	}

	finalEntries, err := svc.listSSHEntries(ctx, scope, ".")
	if err != nil {
		t.Fatalf("listSSHEntries final failed: %v", err)
	}
	if len(finalEntries) != 0 {
		t.Fatalf("final entries = %#v; want empty sandbox", finalEntries)
	}
	if len(scanner.scans) == 0 {
		t.Fatal("expected managed scanner usage")
	}
}

func TestSSHSandboxRejectsAbsolutePaths(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

	tests := []struct {
		name string
		path string
	}{
		{name: "root slash", path: "/"},
		{name: "absolute unix", path: "/tmp/report.txt"},
		{name: "drive root", path: "C:/Users/test/report.txt"},
		{name: "drive root backslash", path: `C:\Users\test\report.txt`},
		{name: "uri", path: "file:///tmp/report.txt"},
		{name: "uri scheme", path: "s3://bucket/report.txt"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := svc.listSSHEntries(ctx, scope, tc.path)
			assertSSHSandboxRejection(t, err)

			err = svc.createSSHDirectory(ctx, remote, scope, tc.path)
			assertSSHSandboxRejection(t, err)

_, err = svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", tc.path, []byte("payload"))
			assertSSHSandboxRejection(t, err)

_, err = svc.downloadFromSSH(ctx, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", tc.path)
			assertSSHSandboxRejection(t, err)

			err = svc.renameSSHPath(ctx, remote, scope, "docs/report.txt", tc.path)
			assertSSHSandboxRejection(t, err)
		})
	}
}

func TestSSHSandboxRejectsTraversal(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

	for _, invalidPath := range []string{"../secret.txt", "docs/../../secret.txt", "docs/../secret.txt", "../../", "../"} {
		t.Run(invalidPath, func(t *testing.T) {
			_, err := svc.listSSHEntries(ctx, scope, invalidPath)
			assertSSHSandboxRejection(t, err)

			err = svc.deleteSSHPath(ctx, remote, scope, invalidPath)
			assertSSHSandboxRejection(t, err)

_, err = svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", invalidPath, []byte("payload"))
			assertSSHSandboxRejection(t, err)

			err = svc.renameSSHPath(ctx, remote, scope, invalidPath, "docs/final.txt")
			assertSSHSandboxRejection(t, err)
		})
	}
}

func TestSSHSandboxDeleteRestoresMirrorSnapshotOnPartialFailure(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

	if err := svc.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("createSSHDirectory failed: %v", err)
	}
if _, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "alpha.txt", "docs/alpha.txt", []byte("delete me alpha")); err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
if _, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "bravo.txt", "docs/bravo.txt", []byte("delete me bravo")); err != nil {
		t.Fatalf("second uploadToSSH failed: %v", err)
	}
	removeCalls := 0
	remote.removeHook = func(path string) error {
		removeCalls++
		if removeCalls == 2 {
			return errors.New("mirror delete failed")
		}
		return nil
	}

	err := svc.deleteSSHPath(ctx, remote, scope, "docs")
	if err == nil {
		t.Fatal("expected deleteSSHPath to fail")
	}
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	for _, name := range []string{"docs/alpha.txt", "docs/bravo.txt"} {
		if _, statErr := store.delegate.Stat(ctx, sshWorkspaceFileKey(workspacePrefix, name)); statErr != nil {
			t.Fatalf("expected workspace file %s to be restored, got %v", name, statErr)
		}
	}
	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, scope)
	for _, name := range []string{"alpha.txt", "bravo.txt"} {
		if _, ok := remote.fs[path.Join(mirrorRoot, "docs", name)]; !ok {
			t.Fatalf("expected remote mirror file %s to remain restored, got %#v", name, remote.fs)
		}
	}
}

func TestSSHSandboxRenameRestoresMirrorSnapshotOnPartialFailure(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	target := sshsessions.ResolvedFileTransferTarget{Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"}}

	if err := svc.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("createSSHDirectory failed: %v", err)
	}
if _, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "alpha.txt", "docs/alpha.txt", []byte("rename me alpha")); err != nil {
		t.Fatalf("uploadToSSH failed: %v", err)
	}
if _, err := svc.uploadToSSH(ctx, remote, target, resolvedFilePolicy{}, "user-1", "tenant-1", "", "bravo.txt", "docs/bravo.txt", []byte("rename me bravo")); err != nil {
		t.Fatalf("second uploadToSSH failed: %v", err)
	}
	removeCalls := 0
	remote.removeHook = func(path string) error {
		removeCalls++
		if removeCalls == 3 || removeCalls == 4 {
			return errors.New("mirror rename failed")
		}
		return nil
	}

	err := svc.renameSSHPath(ctx, remote, scope, "docs", "archive/docs")
	if err == nil {
		t.Fatal("expected renameSSHPath to fail")
	}
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	for _, name := range []string{"docs/alpha.txt", "docs/bravo.txt"} {
		if _, err := store.delegate.Stat(ctx, sshWorkspaceFileKey(workspacePrefix, name)); err != nil {
			t.Fatalf("expected original workspace file %s to remain, got %v", name, err)
		}
	}
	if _, err := store.delegate.Stat(ctx, sshWorkspaceDirectoryKey(workspacePrefix, "archive/docs")); err == nil {
		t.Fatal("expected renamed workspace directory to be rolled back")
	}
	if removeCalls < 5 {
		t.Fatalf("removeCalls = %d; want rollback cleanup retry", removeCalls)
	}
	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, scope)
	for _, name := range []string{"alpha.txt", "bravo.txt"} {
		if _, ok := remote.fs[path.Join(mirrorRoot, "docs", name)]; !ok {
			t.Fatalf("expected remote mirror file %s to remain at original path, got %#v", name, remote.fs)
		}
	}
	if _, ok := remote.fs[path.Join(mirrorRoot, "archive", "docs")]; ok {
		t.Fatalf("expected renamed mirror directory to be rolled back, got %#v", remote.fs)
	}
}

func assertSSHSandboxRejection(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected error")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != 400 {
		t.Fatalf("status = %d; want 400", reqErr.status)
	}
	if reqErr.message != sshSandboxRelativePathErrorText {
		t.Fatalf("message = %q; want %q", reqErr.message, sshSandboxRelativePathErrorText)
	}
}

func containsString(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
