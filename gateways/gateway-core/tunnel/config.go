// Package tunnel provides a WebSocket tunnel client for connecting gateway
// agents to the Arsenale TunnelBroker server with reconnection, heartbeat,
// mTLS support, and stream multiplexing.
package tunnel

import (
	"fmt"
	"os"
	"strconv"
	"time"
)

// Config holds the tunnel client configuration, typically loaded from
// environment variables via LoadConfigFromEnv.
type Config struct {
	// ServerURL is the WSS endpoint of the TunnelBroker (required).
	ServerURL string
	// Token is the 256-bit hex bearer token for authentication (required).
	Token string
	// GatewayID identifies this gateway instance (required).
	GatewayID string
	// AgentVersion is reported in the X-Agent-Version header.
	AgentVersion string

	// LocalHost is the local service address for health probes (default "127.0.0.1").
	LocalHost string
	// LocalPort is the local service port for health probes (default 0 = disabled).
	LocalPort int

	// mTLS certificates are optional for development/testing. Production
	// deployments MUST provide CA cert, client cert, and client key for
	// mutual TLS authentication.

	// CACert is the PEM-encoded CA certificate for server verification (optional).
	CACert string
	// ClientCert is the PEM-encoded client certificate for mTLS (optional).
	ClientCert string
	// ClientKey is the PEM-encoded client private key for mTLS (optional).
	ClientKey string

	// PingInterval controls heartbeat frequency (default 15s).
	PingInterval time.Duration
	// ReconnectInitial is the initial reconnection delay (default 1s).
	ReconnectInitial time.Duration
	// ReconnectMax is the maximum reconnection delay (default 60s).
	ReconnectMax time.Duration
}

// LoadConfigFromEnv creates a Config from environment variables.
// Required: TUNNEL_SERVER_URL, TUNNEL_TOKEN, TUNNEL_GATEWAY_ID.
func LoadConfigFromEnv() (*Config, error) {
	serverURL := os.Getenv("TUNNEL_SERVER_URL")
	if serverURL == "" {
		return nil, fmt.Errorf("TUNNEL_SERVER_URL is required")
	}
	token := os.Getenv("TUNNEL_TOKEN")
	if token == "" {
		return nil, fmt.Errorf("TUNNEL_TOKEN is required")
	}
	gatewayID := os.Getenv("TUNNEL_GATEWAY_ID")
	if gatewayID == "" {
		return nil, fmt.Errorf("TUNNEL_GATEWAY_ID is required")
	}

	cfg := &Config{
		ServerURL:        serverURL,
		Token:            token,
		GatewayID:        gatewayID,
		AgentVersion:     envOrDefault("TUNNEL_AGENT_VERSION", "1.0.0"),
		LocalHost:        envOrDefault("TUNNEL_LOCAL_HOST", "127.0.0.1"),
		LocalPort:        envInt("TUNNEL_LOCAL_PORT", 0),
		CACert:           os.Getenv("TUNNEL_CA_CERT"),
		ClientCert:       os.Getenv("TUNNEL_CLIENT_CERT"),
		ClientKey:        os.Getenv("TUNNEL_CLIENT_KEY"),
		PingInterval:     time.Duration(envInt("TUNNEL_PING_INTERVAL_MS", 15000)) * time.Millisecond,
		ReconnectInitial: time.Duration(envInt("TUNNEL_RECONNECT_INITIAL_MS", 1000)) * time.Millisecond,
		ReconnectMax:     time.Duration(envInt("TUNNEL_RECONNECT_MAX_MS", 60000)) * time.Millisecond,
	}
	return cfg, nil
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}
