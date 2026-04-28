package main

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestLoadConfigDormantWhenCoreTunnelVarsUnset(t *testing.T) {
	cfg, dormant, err := loadConfigFrom(mapEnv(nil), nilFileReader)
	if err != nil {
		t.Fatalf("loadConfigFrom returned error: %v", err)
	}
	if !dormant {
		t.Fatalf("expected dormant mode")
	}
	if cfg != nil {
		t.Fatalf("expected nil config in dormant mode")
	}
}

func TestLoadConfigRequiresAllTunnelVarsWhenPartiallyConfigured(t *testing.T) {
	_, dormant, err := loadConfigFrom(mapEnv(map[string]string{
		"TUNNEL_SERVER_URL": "wss://example.com/api/tunnel/connect",
	}), nilFileReader)
	if dormant {
		t.Fatalf("partial tunnel config must not be dormant")
	}
	if err == nil {
		t.Fatalf("expected missing env error")
	}
	for _, key := range []string{"TUNNEL_TOKEN", "TUNNEL_GATEWAY_ID", "TUNNEL_LOCAL_PORT"} {
		if !strings.Contains(err.Error(), key) {
			t.Fatalf("expected missing key %s in error %q", key, err.Error())
		}
	}
}

func TestLoadConfigParsesRequiredAndDefaultValues(t *testing.T) {
	cfg, dormant, err := loadConfigFrom(mapEnv(map[string]string{
		"TUNNEL_SERVER_URL": "wss://example.com/api/tunnel/connect",
		"TUNNEL_TOKEN":      "token",
		"TUNNEL_GATEWAY_ID": "gw-1",
		"TUNNEL_LOCAL_PORT": "4822",
	}), nilFileReader)
	if err != nil {
		t.Fatalf("loadConfigFrom returned error: %v", err)
	}
	if dormant {
		t.Fatalf("valid config must not be dormant")
	}
	if cfg.ServerURL != "wss://example.com/api/tunnel/connect" {
		t.Fatalf("unexpected server URL %q", cfg.ServerURL)
	}
	if cfg.LocalServiceHost != "127.0.0.1" {
		t.Fatalf("unexpected default local host %q", cfg.LocalServiceHost)
	}
	if cfg.LocalServicePort != 4822 {
		t.Fatalf("unexpected local port %d", cfg.LocalServicePort)
	}
	if cfg.PingInterval != 15*time.Second {
		t.Fatalf("unexpected default ping interval %s", cfg.PingInterval)
	}
	if cfg.ReconnectInitial != time.Second {
		t.Fatalf("unexpected default reconnect initial %s", cfg.ReconnectInitial)
	}
	if cfg.ReconnectMax != time.Minute {
		t.Fatalf("unexpected default reconnect max %s", cfg.ReconnectMax)
	}
}

func TestLoadConfigReadsPEMValuesFromFiles(t *testing.T) {
	files := map[string][]byte{
		"/ca.pem":     []byte("ca-pem\n"),
		"/client.pem": []byte("client-pem\n"),
		"/client.key": []byte("client-key\n"),
	}
	cfg, _, err := loadConfigFrom(mapEnv(map[string]string{
		"TUNNEL_SERVER_URL":       "wss://example.com/api/tunnel/connect",
		"TUNNEL_TOKEN":            "token",
		"TUNNEL_GATEWAY_ID":       "gw-1",
		"TUNNEL_LOCAL_PORT":       "2222",
		"TUNNEL_CA_CERT_FILE":     "/ca.pem",
		"TUNNEL_CLIENT_CERT_FILE": "/client.pem",
		"TUNNEL_CLIENT_KEY_FILE":  "/client.key",
	}), mapFileReader(files))
	if err != nil {
		t.Fatalf("loadConfigFrom returned error: %v", err)
	}
	if cfg.CACert != "ca-pem" || cfg.ClientCert != "client-pem" || cfg.ClientKey != "client-key" {
		t.Fatalf("unexpected PEM values: %#v", cfg)
	}
}

func TestLoadConfigIgnoresNonPositiveDurationOverrides(t *testing.T) {
	cfg, _, err := loadConfigFrom(mapEnv(map[string]string{
		"TUNNEL_SERVER_URL":           "wss://example.com/api/tunnel/connect",
		"TUNNEL_TOKEN":                "token",
		"TUNNEL_GATEWAY_ID":           "gw-1",
		"TUNNEL_LOCAL_PORT":           "2222",
		"TUNNEL_PING_INTERVAL_MS":     "0",
		"TUNNEL_RECONNECT_INITIAL_MS": "-1",
		"TUNNEL_RECONNECT_MAX_MS":     "not-a-number",
	}), nilFileReader)
	if err != nil {
		t.Fatalf("loadConfigFrom returned error: %v", err)
	}
	if cfg.PingInterval != 15*time.Second {
		t.Fatalf("unexpected ping interval %s", cfg.PingInterval)
	}
	if cfg.ReconnectInitial != time.Second {
		t.Fatalf("unexpected reconnect initial %s", cfg.ReconnectInitial)
	}
	if cfg.ReconnectMax != time.Minute {
		t.Fatalf("unexpected reconnect max %s", cfg.ReconnectMax)
	}
}

func TestLoadConfigRejectsInvalidLocalPort(t *testing.T) {
	_, _, err := loadConfigFrom(mapEnv(map[string]string{
		"TUNNEL_SERVER_URL": "wss://example.com/api/tunnel/connect",
		"TUNNEL_TOKEN":      "token",
		"TUNNEL_GATEWAY_ID": "gw-1",
		"TUNNEL_LOCAL_PORT": "99999",
	}), nilFileReader)
	if err == nil {
		t.Fatalf("expected invalid port error")
	}
}

func mapEnv(values map[string]string) envLookup {
	return func(key string) string {
		return values[key]
	}
}

func mapFileReader(files map[string][]byte) fileReader {
	return func(path string) ([]byte, error) {
		value, ok := files[path]
		if !ok {
			return nil, errors.New("file not found")
		}
		return value, nil
	}
}

func nilFileReader(string) ([]byte, error) {
	return nil, errors.New("unexpected file read")
}
