package main

import (
	"net/url"
	"strings"
	"testing"
)

func TestBuildAuthHeaders(t *testing.T) {
	cfg := testConfig()
	cfg.ClientCert = "-----BEGIN CERTIFICATE-----\nabc+123\n-----END CERTIFICATE-----"

	headers := buildAuthHeaders(cfg)
	if got := headers.Get("Authorization"); got != "Bearer token" {
		t.Fatalf("unexpected Authorization header %q", got)
	}
	if got := headers.Get("X-Gateway-Id"); got != "gw-1" {
		t.Fatalf("unexpected X-Gateway-Id header %q", got)
	}
	if got := headers.Get("X-Agent-Version"); got != defaultAgentVersion {
		t.Fatalf("unexpected X-Agent-Version header %q", got)
	}
	decoded, err := url.QueryUnescape(headers.Get("X-Client-Cert"))
	if err != nil {
		t.Fatalf("client cert header is not URL encoded: %v", err)
	}
	if decoded != cfg.ClientCert {
		t.Fatalf("unexpected decoded client cert header %q", decoded)
	}
}

func TestBuildAuthHeadersDoesNotPutTokenInURLFields(t *testing.T) {
	cfg := testConfig()
	cfg.Token = "super-secret-token"
	headers := buildAuthHeaders(cfg)
	if strings.Contains(cfg.ServerURL, cfg.Token) {
		t.Fatalf("test config unexpectedly contains token in URL")
	}
	if headers.Get("Authorization") != "Bearer super-secret-token" {
		t.Fatalf("token must only appear in Authorization header")
	}
}

func TestBuildTLSConfigOmitTLSWhenNoCertsProvided(t *testing.T) {
	tlsConfig, err := buildTLSConfig(testConfig())
	if err != nil {
		t.Fatalf("buildTLSConfig returned error: %v", err)
	}
	if tlsConfig != nil {
		t.Fatalf("expected nil TLS config")
	}
}

func TestBuildTLSConfigRejectsInvalidCA(t *testing.T) {
	cfg := testConfig()
	cfg.CACert = "not a certificate"
	if _, err := buildTLSConfig(cfg); err == nil {
		t.Fatalf("expected invalid CA error")
	}
}

func testConfig() *tunnelConfig {
	return &tunnelConfig{
		ServerURL:        "ws://example.test/api/tunnel/connect",
		Token:            "token",
		GatewayID:        "gw-1",
		AgentVersion:     defaultAgentVersion,
		PingInterval:     15_000_000_000,
		ReconnectInitial: 1_000_000_000,
		ReconnectMax:     60_000_000_000,
		LocalServiceHost: "127.0.0.1",
		LocalServicePort: 4822,
	}
}
