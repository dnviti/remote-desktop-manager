package files

import (
	"context"
	"testing"
)

func TestBuildManagedTransferAuditDetailsIncludesManagedFields(t *testing.T) {
	details := buildManagedTransferAuditDetails(
		"ssh",
		"tmp/report.txt",
		"report.txt",
		42,
		"stage/key",
		"corr-123",
		map[string]string{"sha256": "abc123"},
	)

	if got := details["protocol"]; got != "ssh" {
		t.Fatalf("protocol = %#v; want ssh", got)
	}
	if got := details["transferMode"]; got != managedAuditTransferModePayload {
		t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModePayload)
	}
	if got := details["remotePath"]; got != "/tmp/report.txt" {
		t.Fatalf("remotePath = %#v; want /tmp/report.txt", got)
	}
	if got := details["fileName"]; got != "report.txt" {
		t.Fatalf("fileName = %#v; want report.txt", got)
	}
	if got := details["size"]; got != int64(42) {
		t.Fatalf("size = %#v; want 42", got)
	}
	if got := details["objectKey"]; got != "stage/key" {
		t.Fatalf("objectKey = %#v; want stage/key", got)
	}
	if got := details["transferId"]; got != "corr-123" {
		t.Fatalf("transferId = %#v; want corr-123", got)
	}
	if got := details["checksumSha256"]; got != "abc123" {
		t.Fatalf("checksumSha256 = %#v; want abc123", got)
	}
	if got := details["policyDecision"]; got != managedAuditPolicyAllowed {
		t.Fatalf("policyDecision = %#v; want %q", got, managedAuditPolicyAllowed)
	}
	if got := details["scanResult"]; got != managedAuditScanClean {
		t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanClean)
	}
	if got := details["result"]; got != managedAuditResultSuccess {
		t.Fatalf("result = %#v; want %q", got, managedAuditResultSuccess)
	}
}

func TestBuildManagedTransferDeniedAuditDetailsIncludesManagedFields(t *testing.T) {
	details := buildManagedTransferDeniedAuditDetails("ssh", "tmp/blocked.txt", "blocked.txt", "disabled by organization policy")

	if got := details["protocol"]; got != "ssh" {
		t.Fatalf("protocol = %#v; want ssh", got)
	}
	if got := details["transferMode"]; got != managedAuditTransferModePayload {
		t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModePayload)
	}
	if got := details["remotePath"]; got != "/tmp/blocked.txt" {
		t.Fatalf("remotePath = %#v; want /tmp/blocked.txt", got)
	}
	if got := details["fileName"]; got != "blocked.txt" {
		t.Fatalf("fileName = %#v; want blocked.txt", got)
	}
	if got := details["policyDecision"]; got != managedAuditPolicyDenied {
		t.Fatalf("policyDecision = %#v; want %q", got, managedAuditPolicyDenied)
	}
	if got := details["scanResult"]; got != managedAuditScanNotScanned {
		t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanNotScanned)
	}
	if got := details["result"]; got != managedAuditResultDenied {
		t.Fatalf("result = %#v; want %q", got, managedAuditResultDenied)
	}
	if got := details["reason"]; got != "disabled by organization policy" {
		t.Fatalf("reason = %#v; want disabled by organization policy", got)
	}
}

func TestManagedAuditActionMapsManagedOperations(t *testing.T) {
	tests := []struct {
		operation managedFileOperation
		want      string
	}{
		{operation: managedFileOperationUpload, want: auditActionFileUpload},
		{operation: managedFileOperationDownload, want: auditActionFileDownload},
		{operation: managedFileOperationDelete, want: auditActionFileDelete},
		{operation: managedFileOperationMkdir, want: auditActionFileMkdir},
		{operation: managedFileOperationRename, want: auditActionFileRename},
		{operation: managedFileOperationList, want: auditActionFileList},
	}

	for _, tc := range tests {
		if got := managedAuditAction(tc.operation); got != tc.want {
			t.Fatalf("managedAuditAction(%q) = %q; want %q", tc.operation, got, tc.want)
		}
	}
}

func TestAuditWriteContextIgnoresCancellation(t *testing.T) {
	parent, cancel := context.WithCancel(context.Background())
	cancel()

	ctx := auditWriteContext(parent)
	if err := ctx.Err(); err != nil {
		t.Fatalf("audit write context unexpectedly canceled: %v", err)
	}
}

func TestBuildManagedRDPPayloadAuditDetailsIncludesManagedFields(t *testing.T) {
	transfer := managedPayloadResult{
		StageKey:           "shared-files/rdp-upload/stage/key",
		AuditCorrelationID: "corr-rdp-123",
		Metadata:           map[string]string{"sha256": "def456", "managed-operation": string(managedFileOperationDownload)},
	}
	details := buildManagedRDPPayloadAuditDetails("report.txt", "report.txt", 128, transfer)

	if got := details["protocol"]; got != "rdp" {
		t.Fatalf("protocol = %#v; want rdp", got)
	}
	if got := details["transferMode"]; got != managedAuditTransferModePayload {
		t.Fatalf("transferMode = %#v; want %q", got, managedAuditTransferModePayload)
	}
	if got := details["remotePath"]; got != "/report.txt" {
		t.Fatalf("remotePath = %#v; want /report.txt", got)
	}
	if got := details["objectKey"]; got != transfer.StageKey {
		t.Fatalf("objectKey = %#v; want %q", got, transfer.StageKey)
	}
	if got := details["transferId"]; got != transfer.AuditCorrelationID {
		t.Fatalf("transferId = %#v; want %q", got, transfer.AuditCorrelationID)
	}
	if got := details["checksumSha256"]; got != "def456" {
		t.Fatalf("checksumSha256 = %#v; want def456", got)
	}
	if got := details["scanResult"]; got != managedAuditScanClean {
		t.Fatalf("scanResult = %#v; want %q", got, managedAuditScanClean)
	}
	if got := details["workspace"]; got != managedAuditDispositionRead {
		t.Fatalf("workspace = %#v; want %q", got, managedAuditDispositionRead)
	}
	if got := details["history"]; got != managedAuditDispositionNA {
		t.Fatalf("history = %#v; want %q", got, managedAuditDispositionNA)
	}
	if got := details["cleanup"]; got != managedAuditDispositionCleaned {
		t.Fatalf("cleanup = %#v; want %q", got, managedAuditDispositionCleaned)
	}
}

func TestBuildManagedTransferAuditDetailsDistinguishesHistoryRestore(t *testing.T) {
	details := buildManagedTransferAuditDetails("ssh", "docs/restored.txt", "report.txt", 64, "stage/key", "corr", map[string]string{
		"managed-operation": string(managedFileOperationUpload),
		"history-source":    "true",
	})

	if got := details["workspace"]; got != managedAuditDispositionMaterialized {
		t.Fatalf("workspace = %#v; want %q", got, managedAuditDispositionMaterialized)
	}
	if got := details["history"]; got != managedAuditDispositionRead {
		t.Fatalf("history = %#v; want %q", got, managedAuditDispositionRead)
	}
	if got := details["restore"]; got != managedAuditDispositionApplied {
		t.Fatalf("restore = %#v; want %q", got, managedAuditDispositionApplied)
	}
	if got := details["cleanup"]; got != managedAuditDispositionCleaned {
		t.Fatalf("cleanup = %#v; want %q", got, managedAuditDispositionCleaned)
	}
}

func TestBuildManagedMetadataAuditDetailsSupportsHistoryDisposition(t *testing.T) {
	details := buildManagedMetadataAuditDetails("rdp", "", map[string]any{"history": managedAuditDispositionListed})

	if got := details["workspace"]; got != managedAuditDispositionNA {
		t.Fatalf("workspace = %#v; want %q", got, managedAuditDispositionNA)
	}
	if got := details["history"]; got != managedAuditDispositionListed {
		t.Fatalf("history = %#v; want %q", got, managedAuditDispositionListed)
	}
	if got := details["remotePath"]; got != "/" {
		t.Fatalf("remotePath = %#v; want /", got)
	}
}
