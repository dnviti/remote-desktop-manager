package gateways

import (
	"crypto/x509"
	"encoding/pem"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestAggregateTunnelOverview(t *testing.T) {
	enabled := map[string]struct{}{
		"gw-1": {},
		"gw-2": {},
		"gw-3": {},
	}
	latencyA := int64(40)
	latencyB := int64(80)

	result := aggregateTunnelOverview(enabled, []contracts.TunnelStatus{
		{GatewayID: "gw-1", Connected: true, PingPongLatencyMs: &latencyA},
		{GatewayID: "gw-2", Connected: true, PingPongLatencyMs: &latencyB},
		{GatewayID: "other", Connected: true},
	})

	if result.Total != 3 {
		t.Fatalf("expected total=3, got %d", result.Total)
	}
	if result.Connected != 2 {
		t.Fatalf("expected connected=2, got %d", result.Connected)
	}
	if result.Disconnected != 1 {
		t.Fatalf("expected disconnected=1, got %d", result.Disconnected)
	}
	if result.AvgRTTMS == nil || *result.AvgRTTMS != 60 {
		t.Fatalf("expected avg RTT 60, got %#v", result.AvgRTTMS)
	}
}

func TestSanitizeTunnelEventDetails(t *testing.T) {
	raw := []byte(`{"clientVersion":"1.2.3","forced":"true","secret":"ignore-me"}`)
	details := sanitizeTunnelEventDetails(raw)

	if details["clientVersion"] != "1.2.3" {
		t.Fatalf("expected clientVersion to be retained, got %#v", details["clientVersion"])
	}
	if details["forced"] != true {
		t.Fatalf("expected forced=true, got %#v", details["forced"])
	}
	if _, ok := details["secret"]; ok {
		t.Fatalf("unexpected secret field in sanitized details: %#v", details)
	}
}

func TestTunnelMetricsFromStatus(t *testing.T) {
	latency := int64(27)
	heartbeatLatency := 11
	streams := 3
	status := &contracts.TunnelStatus{
		GatewayID:         "gw-1",
		Connected:         true,
		ConnectedAt:       "2026-03-31T01:02:03Z",
		LastHeartbeatAt:   "2026-03-31T01:03:04Z",
		ClientVersion:     "1.8.0",
		ClientIP:          "10.0.0.9",
		ActiveStreams:     5,
		BytesTransferred:  4096,
		PingPongLatencyMs: &latency,
		Heartbeat: &contracts.TunnelHeartbeat{
			Healthy:       true,
			LatencyMs:     &heartbeatLatency,
			ActiveStreams: &streams,
		},
	}

	result := tunnelMetricsFromStatus(status)

	if !result.Connected {
		t.Fatal("expected connected metrics")
	}
	if result.ConnectedAt == nil || result.ConnectedAt.Format(time.RFC3339) != "2026-03-31T01:02:03Z" {
		t.Fatalf("unexpected connectedAt: %#v", result.ConnectedAt)
	}
	if result.LastHeartbeat == nil || result.LastHeartbeat.Format(time.RFC3339) != "2026-03-31T01:03:04Z" {
		t.Fatalf("unexpected lastHeartbeat: %#v", result.LastHeartbeat)
	}
	if result.PingPongLatency == nil || *result.PingPongLatency != 27 {
		t.Fatalf("unexpected ping latency: %#v", result.PingPongLatency)
	}
	if result.ActiveStreams == nil || *result.ActiveStreams != 5 {
		t.Fatalf("unexpected active streams: %#v", result.ActiveStreams)
	}
	if result.BytesTransferred == nil || *result.BytesTransferred != 4096 {
		t.Fatalf("unexpected bytes transferred: %#v", result.BytesTransferred)
	}
	if result.ClientVersion == nil || *result.ClientVersion != "1.8.0" {
		t.Fatalf("unexpected client version: %#v", result.ClientVersion)
	}
	if result.ClientIP == nil || *result.ClientIP != "10.0.0.9" {
		t.Fatalf("unexpected client IP: %#v", result.ClientIP)
	}
	if result.Heartbeat == nil || !result.Heartbeat.Healthy {
		t.Fatalf("expected heartbeat metadata, got %#v", result.Heartbeat)
	}
}

func TestGenerateTunnelCertificates(t *testing.T) {
	caCertPEM, caKeyPEM, err := generateCACert("arsenale-tenant-test")
	if err != nil {
		t.Fatalf("generate CA cert: %v", err)
	}

	clientCertPEM, _, expiry, err := generateClientCertificate(caCertPEM, caKeyPEM, "gw-1", buildGatewaySPIFFEID("arsenale.local", "gw-1"))
	if err != nil {
		t.Fatalf("generate client cert: %v", err)
	}

	caBlock, _ := pem.Decode([]byte(caCertPEM))
	clientBlock, _ := pem.Decode([]byte(clientCertPEM))
	if caBlock == nil || clientBlock == nil {
		t.Fatal("expected PEM blocks for CA and client certs")
	}

	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		t.Fatalf("parse CA cert: %v", err)
	}
	clientCert, err := x509.ParseCertificate(clientBlock.Bytes)
	if err != nil {
		t.Fatalf("parse client cert: %v", err)
	}

	roots := x509.NewCertPool()
	roots.AddCert(caCert)
	if _, err := clientCert.Verify(x509.VerifyOptions{
		Roots:       roots,
		CurrentTime: time.Now().UTC(),
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}); err != nil {
		t.Fatalf("verify client cert chain: %v", err)
	}
	if len(clientCert.URIs) != 1 || clientCert.URIs[0].String() != "spiffe://arsenale.local/gateway/gw-1" {
		t.Fatalf("unexpected client cert URIs: %#v", clientCert.URIs)
	}
	if !expiry.After(time.Now().UTC().Add(89 * 24 * time.Hour)) {
		t.Fatalf("unexpected client cert expiry: %s", expiry)
	}
}

func TestTunnelLocalPortForGateway(t *testing.T) {
	tests := []struct {
		name           string
		gatewayType    string
		configuredPort int
		want           int
	}{
		{name: "uses configured port", gatewayType: "GUACD", configuredPort: 14822, want: 14822},
		{name: "managed ssh fallback", gatewayType: "MANAGED_SSH", want: 2222},
		{name: "ssh bastion fallback", gatewayType: "SSH_BASTION", want: 2222},
		{name: "guacd fallback", gatewayType: "GUACD", want: 4822},
		{name: "db proxy fallback", gatewayType: "DB_PROXY", want: 5432},
		{name: "unknown fallback", gatewayType: "OTHER", want: 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tunnelLocalPortForGateway(tt.gatewayType, tt.configuredPort); got != tt.want {
				t.Fatalf("tunnelLocalPortForGateway(%q, %d) = %d, want %d", tt.gatewayType, tt.configuredPort, got, tt.want)
			}
		})
	}
}
