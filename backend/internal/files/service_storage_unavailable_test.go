package files

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func TestManagedPayloadFailsClosedWithoutStore(t *testing.T) {
	t.Run("rdp readiness uses stable storage unavailable error", func(t *testing.T) {
		err := Service{}.ensureReady(context.Background())
		if !errors.Is(err, ErrSharedFilesStorageUnavailable) {
			t.Fatalf("expected storage unavailable error, got %v", err)
		}
		if !errors.Is(err, ErrSharedFilesS3NotConfigured) {
			t.Fatalf("expected missing S3 configuration cause, got %v", err)
		}
		if got := err.Error(); got != ErrSharedFilesStorageUnavailable.Error() {
			t.Fatalf("expected stable readiness error %q, got %q", ErrSharedFilesStorageUnavailable.Error(), got)
		}
	})

	t.Run("ssh upload handler returns stable service unavailable error", func(t *testing.T) {
		body := &bytes.Buffer{}
		writer := multipart.NewWriter(body)
		if err := writer.WriteField("connectionId", "conn-1"); err != nil {
			t.Fatalf("write connectionId: %v", err)
		}
		if err := writer.WriteField("remotePath", "/tmp/report.txt"); err != nil {
			t.Fatalf("write remotePath: %v", err)
		}
		file, err := writer.CreateFormFile("file", "report.txt")
		if err != nil {
			t.Fatalf("create form file: %v", err)
		}
		if _, err := file.Write([]byte("hello upload")); err != nil {
			t.Fatalf("write form file: %v", err)
		}
		if err := writer.Close(); err != nil {
			t.Fatalf("close multipart writer: %v", err)
		}

		req := httptest.NewRequest(http.MethodPost, "/api/files/ssh/upload", body)
		req.Header.Set("Content-Type", writer.FormDataContentType())
		rec := httptest.NewRecorder()

		Service{}.HandleSSHUpload(rec, req, authn.Claims{UserID: "user-1", TenantID: "tenant-1"})

		assertErrorJSON(t, rec, http.StatusServiceUnavailable, ErrSharedFilesStorageUnavailable.Error())
	})

	t.Run("ssh download handler returns stable service unavailable error", func(t *testing.T) {
		req := httptest.NewRequest(http.MethodPost, "/api/files/ssh/download", bytes.NewBufferString(`{"connectionId":"conn-1","path":"/tmp/report.txt"}`))
		rec := httptest.NewRecorder()

		Service{}.HandleSSHDownload(rec, req, authn.Claims{UserID: "user-1", TenantID: "tenant-1"})

		assertErrorJSON(t, rec, http.StatusServiceUnavailable, ErrSharedFilesStorageUnavailable.Error())
	})

		t.Run("ssh upload skips remote write when storage is unavailable", func(t *testing.T) {
			remote := &fakeSSHRemoteClient{}
			service := Service{Scanner: &recordingThreatScanner{}}

_, err := service.uploadToSSH(context.Background(), remote, sshsessions.ResolvedFileTransferTarget{
	Connection: sshsessions.ConnectionSnapshot{ID: "conn-1"},
}, resolvedFilePolicy{}, "user-1", "tenant-1", "", "report.txt", "docs/report.txt", []byte("hello upload"))
			if !errors.Is(err, ErrSharedFilesStorageUnavailable) {
				t.Fatalf("expected storage unavailable error, got %v", err)
			}
		if len(remote.createPaths) != 0 {
			t.Fatalf("expected remote write to be skipped, got create calls %#v", remote.createPaths)
		}
	})
}

func assertErrorJSON(t *testing.T, rec *httptest.ResponseRecorder, wantStatus int, wantError string) {
	t.Helper()
	if rec.Code != wantStatus {
		t.Fatalf("expected status %d, got %d with body %s", wantStatus, rec.Code, rec.Body.String())
	}

	var payload struct {
		Error string `json:"error"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode error response: %v", err)
	}
	if payload.Error != wantError {
		t.Fatalf("expected error %q, got %q", wantError, payload.Error)
	}
}
