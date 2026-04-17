package files

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestManagedHistoryKeyAllowsDoubleDotsInIDs(t *testing.T) {
	got, err := managedHistoryKey("shared-files/rdp/tenants/tenant-1/users/user-1/connections/conn-1/history/uploads", "1700000000-report..txt")
	if err != nil {
		t.Fatalf("managedHistoryKey returned error: %v", err)
	}
	want := "shared-files/rdp/tenants/tenant-1/users/user-1/connections/conn-1/history/uploads/1700000000-report..txt"
	if got != want {
		t.Fatalf("managedHistoryKey = %q; want %q", got, want)
	}
}

func TestManagedHistoryKeyRejectsTraversal(t *testing.T) {
	for _, id := range []string{"../secret", "foo/bar", `foo\\bar`} {
		if _, err := managedHistoryKey("shared-files/rdp/history/uploads", id); err == nil {
			t.Fatalf("expected %q to be rejected", id)
		}
	}
}

func TestManagedDownloadPolicyError(t *testing.T) {
	if err := managedDownloadPolicyError(resolvedFilePolicy{}); err != nil {
		t.Fatalf("expected download policy to allow access, got %v", err)
	}

	err := managedDownloadPolicyError(resolvedFilePolicy{DisableDownload: true})
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != http.StatusForbidden {
		t.Fatalf("status = %d; want %d", reqErr.status, http.StatusForbidden)
	}
	if reqErr.message != "File download is disabled by organization policy" {
		t.Fatalf("message = %q; want download policy message", reqErr.message)
	}
}

func TestDownloadManagedHistoryRespectsDownloadPolicy(t *testing.T) {
	ctx := context.Background()
	store := newRecordingObjectStore()
	svc := Service{Store: store, Scanner: &recordingThreatScanner{}}
	historyPrefix := historyUploadsPrefix("rdp", "tenant-1", "user-1", "conn-1")
	stagePrefix := stagePrefix("rdp", "tenant-1", "user-1", "conn-1")

	if err := svc.retainSuccessfulUpload(ctx, historyPrefix, "report..txt", []byte("history payload"), map[string]string{"audit-correlation-id": "corr-history"}, managedHistoryRetentionOptions{Protocol: "rdp", ActorID: "user-1"}); err != nil {
		t.Fatalf("retainSuccessfulUpload failed: %v", err)
	}
	history, err := svc.listManagedHistory(ctx, historyPrefix)
	if err != nil {
		t.Fatalf("listManagedHistory failed: %v", err)
	}
	if len(history) != 1 {
		t.Fatalf("history length = %d; want 1", len(history))
	}

	_, _, _, _, err = svc.downloadManagedHistory(ctx, historyPrefix, stagePrefix, history[0].ID, resolvedFilePolicy{DisableDownload: true})
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T: %v", err, err)
	}
	if reqErr.status != http.StatusForbidden {
		t.Fatalf("status = %d; want %d", reqErr.status, http.StatusForbidden)
	}
	if len(store.getKeys) != 0 {
		t.Fatalf("expected no history payload reads, got %#v", store.getKeys)
	}
}
