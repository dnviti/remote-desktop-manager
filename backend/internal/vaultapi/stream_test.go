package vaultapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func TestHandleStatusStreamPublishesMatchingVaultStatusUpdatesImmediately(t *testing.T) {
	t.Parallel()

	svc, _ := newVaultTouchTestService(t)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	req := httptest.NewRequest(http.MethodGet, "/api/vault/status/stream", nil).WithContext(ctx)
	writer := newStreamCaptureWriter()

	var (
		statusMu sync.Mutex
		status   = statusResponse{
			Unlocked:           false,
			VaultNeedsRecovery: false,
			MFAUnlockAvailable: true,
			MFAUnlockMethods:   []string{"totp"},
		}
	)

	loadStatus := func(context.Context) (statusResponse, error) {
		statusMu.Lock()
		defer statusMu.Unlock()
		return status, nil
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		svc.handleStatusStream(writer, req, "user-1", loadStatus)
	}()

	writer.waitForFlushes(t, 2)

	statusMu.Lock()
	status = statusResponse{
		Unlocked:           true,
		VaultNeedsRecovery: false,
		MFAUnlockAvailable: true,
		MFAUnlockMethods:   []string{"webauthn"},
	}
	statusMu.Unlock()

	if err := svc.publishVaultStatus(context.Background(), "user-1", true); err != nil {
		t.Fatalf("publishVaultStatus() error = %v", err)
	}

	writer.waitForFlushes(t, 3)
	cancel()

	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("handleStatusStream() did not exit after cancellation")
	}

	payloads := decodeSnapshotPayloads(t, writer.Body())
	if len(payloads) != 2 {
		t.Fatalf("len(snapshot payloads) = %d, want 2; body = %q", len(payloads), writer.Body())
	}
	if payloads[0].Unlocked {
		t.Fatalf("initial snapshot unlocked = %v, want false", payloads[0].Unlocked)
	}
	if got := payloads[0].MFAUnlockMethods; len(got) != 1 || got[0] != "totp" {
		t.Fatalf("initial snapshot MFA methods = %v, want [totp]", got)
	}
	if !payloads[1].Unlocked {
		t.Fatalf("pubsub snapshot unlocked = %v, want true", payloads[1].Unlocked)
	}
	if got := payloads[1].MFAUnlockMethods; len(got) != 1 || got[0] != "webauthn" {
		t.Fatalf("pubsub snapshot MFA methods = %v, want [webauthn]", got)
	}
}

type streamCaptureWriter struct {
	header     http.Header
	mu         sync.Mutex
	body       bytes.Buffer
	flushCount int
	flushes    chan struct{}
}

func newStreamCaptureWriter() *streamCaptureWriter {
	return &streamCaptureWriter{
		header:  make(http.Header),
		flushes: make(chan struct{}, 16),
	}
}

func (w *streamCaptureWriter) Header() http.Header {
	return w.header
}

func (w *streamCaptureWriter) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.Write(data)
}

func (w *streamCaptureWriter) WriteHeader(int) {}

func (w *streamCaptureWriter) Flush() {
	w.mu.Lock()
	w.flushCount++
	w.mu.Unlock()
	select {
	case w.flushes <- struct{}{}:
	default:
	}
}

func (w *streamCaptureWriter) waitForFlushes(t *testing.T, want int) {
	t.Helper()

	timeout := time.After(2 * time.Second)
	for {
		w.mu.Lock()
		current := w.flushCount
		w.mu.Unlock()
		if current >= want {
			return
		}

		select {
		case <-w.flushes:
		case <-timeout:
			t.Fatalf("flush count = %d, want >= %d", current, want)
		}
	}
}

func (w *streamCaptureWriter) Body() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.body.String()
}

func decodeSnapshotPayloads(t *testing.T, body string) []statusResponse {
	t.Helper()

	blocks := strings.Split(body, "\n\n")
	payloads := make([]statusResponse, 0, len(blocks))
	for _, block := range blocks {
		if !strings.Contains(block, "event: snapshot") {
			continue
		}
		for _, line := range strings.Split(block, "\n") {
			if !strings.HasPrefix(line, "data: ") {
				continue
			}
			var payload statusResponse
			if err := json.Unmarshal([]byte(strings.TrimPrefix(line, "data: ")), &payload); err != nil {
				t.Fatalf("json.Unmarshal(snapshot payload) error = %v", err)
			}
			payloads = append(payloads, payload)
			break
		}
	}
	return payloads
}
