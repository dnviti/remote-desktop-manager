package main

import (
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	ServerURL        string
	Token            string
	GatewayID        string
	CACert           string
	ClientCert       string
	ClientKey        string
	AgentVersion     string
	PingInterval     time.Duration
	ReconnectInitial time.Duration
	ReconnectMax     time.Duration
	LocalServiceHost string
	LocalServicePort int
}

func LoadConfigFromEnv(defaultVersion string) (*Config, bool, error) {
	serverURL := strings.TrimSpace(os.Getenv("TUNNEL_SERVER_URL"))
	token := strings.TrimSpace(os.Getenv("TUNNEL_TOKEN"))
	gatewayID := strings.TrimSpace(os.Getenv("TUNNEL_GATEWAY_ID"))
	localPortRaw := strings.TrimSpace(os.Getenv("TUNNEL_LOCAL_PORT"))

	if serverURL == "" && token == "" && gatewayID == "" {
		return nil, true, nil
	}

	missing := make([]string, 0, 4)
	if serverURL == "" {
		missing = append(missing, "TUNNEL_SERVER_URL")
	}
	if token == "" {
		missing = append(missing, "TUNNEL_TOKEN")
	}
	if gatewayID == "" {
		missing = append(missing, "TUNNEL_GATEWAY_ID")
	}
	if localPortRaw == "" {
		missing = append(missing, "TUNNEL_LOCAL_PORT")
	}
	if len(missing) > 0 {
		return nil, false, fmt.Errorf("Missing required environment variables: %s", strings.Join(missing, ", "))
	}

	localPort, err := strconv.Atoi(localPortRaw)
	if err != nil || localPort < 1 || localPort > 65535 {
		return nil, false, fmt.Errorf("TUNNEL_LOCAL_PORT must be a valid port number (1-65535)")
	}

	caCert, err := readOptionalPEM("TUNNEL_CA_CERT", "TUNNEL_CA_CERT_FILE")
	if err != nil {
		return nil, false, err
	}
	clientCert, err := readOptionalPEM("TUNNEL_CLIENT_CERT", "TUNNEL_CLIENT_CERT_FILE")
	if err != nil {
		return nil, false, err
	}
	clientKey, err := readOptionalPEM("TUNNEL_CLIENT_KEY", "TUNNEL_CLIENT_KEY_FILE")
	if err != nil {
		return nil, false, err
	}

	return &Config{
		ServerURL:        normalizeTunnelServerURL(serverURL),
		Token:            token,
		GatewayID:        gatewayID,
		CACert:           caCert,
		ClientCert:       clientCert,
		ClientKey:        clientKey,
		AgentVersion:     envOrDefault("TUNNEL_AGENT_VERSION", defaultVersion),
		PingInterval:     envDurationMillis("TUNNEL_PING_INTERVAL_MS", 15000),
		ReconnectInitial: envDurationMillis("TUNNEL_RECONNECT_INITIAL_MS", 1000),
		ReconnectMax:     envDurationMillis("TUNNEL_RECONNECT_MAX_MS", 60000),
		LocalServiceHost: envOrDefault("TUNNEL_LOCAL_HOST", "127.0.0.1"),
		LocalServicePort: localPort,
	}, false, nil
}

func readOptionalPEM(valueKey, fileKey string) (string, error) {
	if value := strings.TrimSpace(os.Getenv(valueKey)); value != "" {
		return value, nil
	}
	filePath := strings.TrimSpace(os.Getenv(fileKey))
	if filePath == "" {
		return "", nil
	}
	contents, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("Failed to read %s from %s: %w", valueKey, filePath, err)
	}
	return strings.TrimSpace(string(contents)), nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDurationMillis(key string, fallback int) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return time.Duration(fallback) * time.Millisecond
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return time.Duration(fallback) * time.Millisecond
	}
	return time.Duration(value) * time.Millisecond
}

func normalizeTunnelServerURL(rawValue string) string {
	trimmed := strings.TrimSpace(rawValue)
	if trimmed == "" {
		return trimmed
	}
	withScheme := trimmed
	if !strings.Contains(withScheme, "://") {
		withScheme = "wss://" + withScheme
	}

	parsed, err := url.Parse(withScheme)
	if err != nil || parsed.Host == "" {
		return trimmed
	}
	explicitWebSocket := parsed.Scheme == "ws" || parsed.Scheme == "wss"
	switch parsed.Scheme {
	case "https":
		parsed.Scheme = "wss"
	case "http":
		parsed.Scheme = "ws"
	case "ws", "wss":
	default:
		parsed.Scheme = "ws"
	}

	path := strings.TrimRight(parsed.Path, "/")
	if explicitWebSocket && path != "" {
		parsed.Path = path
		parsed.RawPath = ""
		parsed.Fragment = ""
		return parsed.String()
	}
	if !strings.HasSuffix(path, "/api/tunnel/connect") {
		if path == "" {
			path = "/api/tunnel/connect"
		} else {
			path += "/api/tunnel/connect"
		}
	}
	parsed.Path = path
	parsed.RawPath = ""
	parsed.Fragment = ""
	return parsed.String()
}
