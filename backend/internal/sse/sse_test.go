package sse

import (
	"net/http/httptest"
	"strings"
	"testing"
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
