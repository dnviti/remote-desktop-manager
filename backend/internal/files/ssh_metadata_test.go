package files

import (
	"context"
	"errors"
	"path"
	"testing"
)

func TestSSHMetadataUsesManagedRestSurface(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")
	workspacePrefix := workspaceCurrentPrefix(scope.Protocol, scope.TenantID, scope.UserID, scope.ConnectionID)
	remote := &fakeSSHRemoteClient{workingDir: "/home/ops"}

	if err := svc.putSSHWorkspaceDirectory(ctx, workspacePrefix, "workspace"); err != nil {
		t.Fatalf("putSSHWorkspaceDirectory failed: %v", err)
	}
	if _, err := svc.writeSSHWorkspaceFile(ctx, workspacePrefix, "workspace/notes.txt", []byte("hello workspace"), map[string]string{"remote-path": "/workspace/notes.txt"}); err != nil {
		t.Fatalf("writeSSHWorkspaceFile failed: %v", err)
	}

	entries, err := svc.listSSHEntries(ctx, scope, "workspace")
	if err != nil {
		t.Fatalf("listSSHEntries failed: %v", err)
	}
	if len(entries) != 1 || entries[0].Name != "notes.txt" || entries[0].Type != "file" {
		t.Fatalf("entries = %#v; want notes.txt file", entries)
	}
	if len(remote.readDirPaths) != 0 {
		t.Fatalf("metadata list should avoid remote filesystem browsing, got %#v", remote.readDirPaths)
	}

	if err := svc.createSSHDirectory(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("createSSHDirectory failed: %v", err)
	}
	mirrorRoot := sshWorkspaceMirrorRootPath(remote.workingDir, scope)
	if !containsString(remote.mkdirPaths, path.Join(mirrorRoot, "docs")) {
		t.Fatalf("mkdir paths = %#v; want sandbox docs path", remote.mkdirPaths)
	}

	if err := svc.renameSSHPath(ctx, remote, scope, "workspace/notes.txt", "workspace/final.txt"); err != nil {
		t.Fatalf("renameSSHPath failed: %v", err)
	}
	if len(remote.renameCalls) == 0 {
		t.Fatal("expected remote rename for sandbox temp file materialization")
	}

	if err := svc.deleteSSHPath(ctx, remote, scope, "workspace/final.txt"); err != nil {
		t.Fatalf("deleteSSHPath file failed: %v", err)
	}
	if err := svc.deleteSSHPath(ctx, remote, scope, "docs"); err != nil {
		t.Fatalf("deleteSSHPath directory failed: %v", err)
	}
	if len(remote.openPaths) != 0 || len(remote.createPaths) == 0 {
		t.Fatal("metadata operations should avoid remote reads and use mirror writes only")
	}
}

func TestSSHMetadataAuditsAllOps(t *testing.T) {
	tests := []struct {
		name         string
		path         string
		extra        map[string]any
		wantPath     string
		wantFileName string
	}{
		{name: "list", path: ".", wantPath: "/"},
		{name: "mkdir", path: "docs/new-dir", wantPath: "/docs/new-dir", wantFileName: "new-dir"},
		{name: "delete", path: "docs/file.txt", wantPath: "/docs/file.txt", wantFileName: "file.txt"},
		{name: "rename", path: "docs/new.txt", wantPath: "/docs/new.txt", wantFileName: "new.txt", extra: map[string]any{"sourceRemotePath": "/docs/old.txt"}},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			details := buildManagedMetadataAuditDetails("ssh", tc.path, tc.extra)
			if got := details["protocol"]; got != "ssh" {
				t.Fatalf("protocol = %#v; want ssh", got)
			}
			if got := details["transferMode"]; got != managedAuditTransferModeMetadata {
				t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModeMetadata)
			}
			if got := details["remotePath"]; got != tc.wantPath {
				t.Fatalf("remotePath = %#v; want %q", got, tc.wantPath)
			}
			if _, ok := details["transferId"]; !ok {
				t.Fatalf("details missing transferId: %#v", details)
			}
			if got := details["policyDecision"]; got != managedAuditPolicyAllowed {
				t.Fatalf("policyDecision = %#v; want %q", got, managedAuditPolicyAllowed)
			}
			if got := details["scanResult"]; got != managedAuditScanNotScanned {
				t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanNotScanned)
			}
			if got := details["result"]; got != managedAuditResultSuccess {
				t.Fatalf("result = %#v; want %q", got, managedAuditResultSuccess)
			}
			if tc.wantFileName == "" {
				if _, ok := details["fileName"]; ok {
					t.Fatalf("fileName unexpectedly set: %#v", details["fileName"])
				}
			} else if got := details["fileName"]; got != tc.wantFileName {
				t.Fatalf("fileName = %#v; want %q", got, tc.wantFileName)
			}
			if tc.name == "rename" {
				if got := details["sourceRemotePath"]; got != "/docs/old.txt" {
					t.Fatalf("sourceRemotePath = %#v; want /docs/old.txt", got)
				}
			}
		})
	}
}

func TestSSHMetadataRejectsInvalidPath(t *testing.T) {
	ctx := context.Background()
	svc := Service{}
	scope := newManagedSandboxScope("ssh", "tenant-1", "user-1", "conn-1")

	for _, tc := range []struct {
		name    string
		run     func() error
		message string
	}{
		{name: "mkdir blank path", run: func() error { return svc.createSSHDirectory(ctx, &fakeSSHRemoteClient{}, scope, "   ") }, message: "path is required"},
		{name: "mkdir root path", run: func() error { return svc.createSSHDirectory(ctx, &fakeSSHRemoteClient{}, scope, "/") }, message: sshSandboxRelativePathErrorText},
		{name: "delete blank path", run: func() error { return svc.deleteSSHPath(ctx, &fakeSSHRemoteClient{}, scope, "") }, message: "path is required"},
		{name: "delete traversal", run: func() error { return svc.deleteSSHPath(ctx, &fakeSSHRemoteClient{}, scope, "../secret") }, message: sshSandboxRelativePathErrorText},
		{name: "rename blank oldPath", run: func() error { return svc.renameSSHPath(ctx, &fakeSSHRemoteClient{}, scope, "", "docs/new") }, message: "oldPath is required"},
		{name: "rename absolute newPath", run: func() error { return svc.renameSSHPath(ctx, &fakeSSHRemoteClient{}, scope, "docs/old", "/tmp/new") }, message: sshSandboxRelativePathErrorText},
	} {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.run()
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
			if reqErr.message != tc.message {
				t.Fatalf("message = %q; want %q", reqErr.message, tc.message)
			}
		})
	}
}
