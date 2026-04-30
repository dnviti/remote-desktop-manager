package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLoadConfigFromEnvDormant(t *testing.T) {
	clearTunnelEnv(t)
	t.Setenv("TUNNEL_LOCAL_PORT", "4822")

	cfg, dormant, err := LoadConfigFromEnv("test-version")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if !dormant {
		t.Fatal("expected dormant mode")
	}
	if cfg != nil {
		t.Fatalf("cfg = %#v, want nil", cfg)
	}
}

func TestLoadConfigFromEnvRequiredAndDefaults(t *testing.T) {
	clearTunnelEnv(t)
	t.Setenv("TUNNEL_SERVER_URL", "https://arsenale.example.com")
	t.Setenv("TUNNEL_TOKEN", "tok")
	t.Setenv("TUNNEL_GATEWAY_ID", "gw")
	t.Setenv("TUNNEL_LOCAL_PORT", "4822")

	cfg, dormant, err := LoadConfigFromEnv("test-version")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if dormant {
		t.Fatal("did not expect dormant mode")
	}
	if cfg.ServerURL != "wss://arsenale.example.com/api/tunnel/connect" {
		t.Fatalf("ServerURL = %q", cfg.ServerURL)
	}
	if cfg.AgentVersion != "test-version" {
		t.Fatalf("AgentVersion = %q", cfg.AgentVersion)
	}
	if cfg.LocalServiceHost != "127.0.0.1" || cfg.LocalServicePort != 4822 {
		t.Fatalf("local service = %s:%d", cfg.LocalServiceHost, cfg.LocalServicePort)
	}
	if cfg.PingInterval != 15*time.Second || cfg.ReconnectInitial != time.Second || cfg.ReconnectMax != time.Minute {
		t.Fatalf("unexpected timing defaults: %#v", cfg)
	}
}

func TestLoadConfigFromEnvRejectsPartialConfig(t *testing.T) {
	clearTunnelEnv(t)
	t.Setenv("TUNNEL_SERVER_URL", "wss://example.com/tunnel")

	_, dormant, err := LoadConfigFromEnv("test-version")
	if dormant {
		t.Fatal("partial config should not be dormant")
	}
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestLoadConfigFromEnvReadsPEMFilesAndInlineWins(t *testing.T) {
	clearTunnelEnv(t)
	dir := t.TempDir()
	caPath := filepath.Join(dir, "ca.pem")
	certPath := filepath.Join(dir, "client.pem")
	keyPath := filepath.Join(dir, "client.key")
	mustWrite(t, caPath, "file-ca\n")
	mustWrite(t, certPath, "file-cert\n")
	mustWrite(t, keyPath, "file-key\n")

	t.Setenv("TUNNEL_SERVER_URL", "wss://example.com/tunnel")
	t.Setenv("TUNNEL_TOKEN", "tok")
	t.Setenv("TUNNEL_GATEWAY_ID", "gw")
	t.Setenv("TUNNEL_LOCAL_PORT", "2222")
	t.Setenv("TUNNEL_CA_CERT", "inline-ca")
	t.Setenv("TUNNEL_CA_CERT_FILE", caPath)
	t.Setenv("TUNNEL_CLIENT_CERT_FILE", certPath)
	t.Setenv("TUNNEL_CLIENT_KEY_FILE", keyPath)

	cfg, _, err := LoadConfigFromEnv("test-version")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.CACert != "inline-ca" || cfg.ClientCert != "file-cert" || cfg.ClientKey != "file-key" {
		t.Fatalf("unexpected PEM values: %#v", cfg)
	}
}

func TestNormalizeTunnelServerURL(t *testing.T) {
	tests := map[string]string{
		"arsenale.example.com":                            "wss://arsenale.example.com/api/tunnel/connect",
		"https://arsenale.example.com":                    "wss://arsenale.example.com/api/tunnel/connect",
		"http://arsenale.example.com/base/":               "ws://arsenale.example.com/base/api/tunnel/connect",
		"wss://arsenale.example.com/custom":               "wss://arsenale.example.com/custom",
		"wss://arsenale.example.com/":                     "wss://arsenale.example.com/api/tunnel/connect",
		"https://arsenale.example.com/api/tunnel/connect": "wss://arsenale.example.com/api/tunnel/connect",
	}
	for raw, want := range tests {
		t.Run(raw, func(t *testing.T) {
			if got := normalizeTunnelServerURL(raw); got != want {
				t.Fatalf("normalizeTunnelServerURL(%q) = %q, want %q", raw, got, want)
			}
		})
	}
}

func clearTunnelEnv(t *testing.T) {
	t.Helper()
	for _, key := range []string{
		"TUNNEL_SERVER_URL", "TUNNEL_TOKEN", "TUNNEL_GATEWAY_ID", "TUNNEL_LOCAL_PORT",
		"TUNNEL_LOCAL_HOST", "TUNNEL_CA_CERT", "TUNNEL_CA_CERT_FILE",
		"TUNNEL_CLIENT_CERT", "TUNNEL_CLIENT_CERT_FILE", "TUNNEL_CLIENT_KEY",
		"TUNNEL_CLIENT_KEY_FILE", "TUNNEL_AGENT_VERSION", "TUNNEL_PING_INTERVAL_MS",
		"TUNNEL_RECONNECT_INITIAL_MS", "TUNNEL_RECONNECT_MAX_MS",
	} {
		key := key
		oldValue, hadValue := os.LookupEnv(key)
		os.Unsetenv(key)
		t.Cleanup(func() {
			if hadValue {
				_ = os.Setenv(key, oldValue)
				return
			}
			_ = os.Unsetenv(key)
		})
	}
}

func mustWrite(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
