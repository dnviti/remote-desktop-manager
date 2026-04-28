package cmd

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
)

func TestAPIClientRetriesOnceAfterRefresh(t *testing.T) {
	var requests int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests++
		switch r.Header.Get("Authorization") {
		case "Bearer old-token":
			http.Error(w, `{"error":"expired"}`, http.StatusUnauthorized)
		case "Bearer new-token":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		default:
			http.Error(w, `{"error":"missing token"}`, http.StatusUnauthorized)
		}
	}))
	defer server.Close()

	cfg := &CLIConfig{
		ServerURL:    server.URL,
		AccessToken:  "old-token",
		RefreshToken: "refresh-token",
	}
	client := APIClient{
		Config: cfg,
		Refresh: func(cfg *CLIConfig) error {
			cfg.AccessToken = "new-token"
			return nil
		},
	}

	body, status, err := client.Request(http.MethodGet, "/profile", nil)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d; body=%s", status, http.StatusOK, string(body))
	}
	if string(body) != `{"ok":true}` {
		t.Fatalf("body = %s", string(body))
	}
	if requests != 2 {
		t.Fatalf("requests = %d, want 2", requests)
	}
}

func TestAPIClientRequestWithParams(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.URL.Query().Get("filter"); got != "active sessions" {
			t.Fatalf("filter = %q", got)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	params := url.Values{}
	params.Set("filter", "active sessions")
	_, status, err := APIClient{Config: &CLIConfig{ServerURL: server.URL}}.
		RequestWithParams(http.MethodGet, "/sessions", params, nil)
	if err != nil {
		t.Fatalf("request failed: %v", err)
	}
	if status != http.StatusOK {
		t.Fatalf("status = %d, want %d", status, http.StatusOK)
	}
}
