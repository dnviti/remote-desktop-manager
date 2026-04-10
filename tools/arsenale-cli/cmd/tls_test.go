package cmd

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDefaultDevCACertPathUsesLocalDevCAForHTTPSLocalhost(t *testing.T) {
	stateHome := t.TempDir()
	caPath := filepath.Join(stateHome, "arsenale-dev", "dev-certs", "client", "ca.pem")
	if err := os.MkdirAll(filepath.Dir(caPath), 0o755); err != nil {
		t.Fatalf("mkdir ca dir: %v", err)
	}
	if err := os.WriteFile(caPath, []byte("pem"), 0o644); err != nil {
		t.Fatalf("write ca file: %v", err)
	}
	t.Setenv("XDG_STATE_HOME", stateHome)

	if got := defaultDevCACertPath("https://localhost:3000"); got != caPath {
		t.Fatalf("expected %s, got %s", caPath, got)
	}
}

func TestDefaultDevCACertPathSkipsNonLocalOrNonHTTPSServers(t *testing.T) {
	stateHome := t.TempDir()
	caPath := filepath.Join(stateHome, "arsenale-dev", "dev-certs", "client", "ca.pem")
	if err := os.MkdirAll(filepath.Dir(caPath), 0o755); err != nil {
		t.Fatalf("mkdir ca dir: %v", err)
	}
	if err := os.WriteFile(caPath, []byte("pem"), 0o644); err != nil {
		t.Fatalf("write ca file: %v", err)
	}
	t.Setenv("XDG_STATE_HOME", stateHome)

	if got := defaultDevCACertPath("http://localhost:3000"); got != "" {
		t.Fatalf("expected no CA for http localhost, got %s", got)
	}
	if got := defaultDevCACertPath("https://example.com"); got != "" {
		t.Fatalf("expected no CA for remote host, got %s", got)
	}
}

func TestResolveCACertPathPrefersEnvOverride(t *testing.T) {
	overridePath := filepath.Join(t.TempDir(), "custom-ca.pem")
	if err := os.WriteFile(overridePath, []byte("pem"), 0o644); err != nil {
		t.Fatalf("write override ca: %v", err)
	}
	t.Setenv("ARSENALE_CA_CERT", overridePath)

	got, err := resolveCACertPath(&CLIConfig{ServerURL: "https://localhost:3000"})
	if err != nil {
		t.Fatalf("resolveCACertPath returned error: %v", err)
	}
	if got != overridePath {
		t.Fatalf("expected %s, got %s", overridePath, got)
	}
}
