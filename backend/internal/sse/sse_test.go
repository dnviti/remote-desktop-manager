package sse

import (
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOpenDoesNotSetConnectionHeader(t *testing.T) {
	recorder := httptest.NewRecorder()

	stream, err := Open(recorder)
	if err != nil {
		t.Fatalf("open stream: %v", err)
	}
	if stream == nil {
		t.Fatal("expected stream instance")
	}

	if got := recorder.Header().Get("Connection"); got != "" {
		t.Fatalf("expected no Connection header, got %q", got)
	}
	if got := recorder.Header().Get("Content-Type"); got != "text/event-stream" {
		t.Fatalf("unexpected content type: %q", got)
	}
	if got := recorder.Header().Get("Cache-Control"); got != "no-cache, no-transform" {
		t.Fatalf("unexpected cache control: %q", got)
	}
	if got := recorder.Header().Get("X-Accel-Buffering"); got != "no" {
		t.Fatalf("unexpected X-Accel-Buffering: %q", got)
	}
	if body := recorder.Body.String(); !strings.HasPrefix(body, "retry: 3000\n\n") {
		t.Fatalf("unexpected initial retry frame: %q", body)
	}
}

func TestOpenClearsWriteDeadline(t *testing.T) {
	recorder := &deadlineRecorder{ResponseRecorder: httptest.NewRecorder()}

	if _, err := Open(recorder); err != nil {
		t.Fatalf("open stream: %v", err)
	}
	if !recorder.called {
		t.Fatal("expected write deadline to be cleared")
	}
	if !recorder.deadline.IsZero() {
		t.Fatalf("expected zero write deadline, got %v", recorder.deadline)
	}
}

type deadlineRecorder struct {
	*httptest.ResponseRecorder
	called   bool
	deadline time.Time
}

func (r *deadlineRecorder) SetWriteDeadline(deadline time.Time) error {
	r.called = true
	r.deadline = deadline
	return nil
}
