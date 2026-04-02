package recordingsapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"
	"time"
)

func TestConvertToVideoAsciicastReadsStatusBeforeCancel(t *testing.T) {
	t.Parallel()

	recordingDir := t.TempDir()
	recordingPath := filepath.Join(recordingDir, "session.cast")
	if err := os.WriteFile(recordingPath, []byte("{\"version\":2}\n"), 0o600); err != nil {
		t.Fatalf("write recording: %v", err)
	}

	outputPath := filepath.Join(recordingDir, "session.cast.mp4")
	var convertCalls atomic.Int32
	var statusCalls atomic.Int32

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/convert-asciicast":
			convertCalls.Add(1)
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]string{"jobId": "job-1"})
		case "/status/job-1":
			statusCalls.Add(1)
			payload, err := json.Marshal(map[string]any{
				"status":     "complete",
				"outputPath": outputPath,
				"fileSize":   int64(64),
			})
			if err != nil {
				t.Fatalf("marshal payload: %v", err)
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write(payload[:len(payload)/2])
			if flusher, ok := w.(http.Flusher); ok {
				flusher.Flush()
			}
			time.Sleep(100 * time.Millisecond)
			_, _ = w.Write(payload[len(payload)/2:])
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	service := Service{
		GuacencServiceURL:     server.URL,
		AsciicastConverterURL: server.URL,
		GuacencTimeout:        5 * time.Second,
	}

	videoPath, fileSize, err := service.ConvertToVideo(context.Background(), recordingResponse{
		Status:   "COMPLETE",
		Format:   "asciicast",
		FilePath: recordingPath,
	})
	if err != nil {
		t.Fatalf("ConvertToVideo returned error: %v", err)
	}
	if videoPath != outputPath {
		t.Fatalf("ConvertToVideo path = %q, want %q", videoPath, outputPath)
	}
	if fileSize != 64 {
		t.Fatalf("ConvertToVideo size = %d, want 64", fileSize)
	}
	if got := convertCalls.Load(); got != 1 {
		t.Fatalf("convert calls = %d, want 1", got)
	}
	if got := statusCalls.Load(); got != 1 {
		t.Fatalf("status calls = %d, want 1", got)
	}
}
