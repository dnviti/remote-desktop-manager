package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

const defaultAgentVersion = "1.7.1"

type tunnelConfig struct {
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

type envLookup func(string) string
type fileReader func(string) ([]byte, error)

func loadConfig() (*tunnelConfig, bool, error) {
	return loadConfigFrom(os.Getenv, os.ReadFile)
}

func loadConfigFrom(getenv envLookup, readFile fileReader) (*tunnelConfig, bool, error) {
	serverURL := strings.TrimSpace(getenv("TUNNEL_SERVER_URL"))
	token := strings.TrimSpace(getenv("TUNNEL_TOKEN"))
	gatewayID := strings.TrimSpace(getenv("TUNNEL_GATEWAY_ID"))
	localPortValue := strings.TrimSpace(getenv("TUNNEL_LOCAL_PORT"))

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
	if localPortValue == "" {
		missing = append(missing, "TUNNEL_LOCAL_PORT")
	}
	if len(missing) > 0 {
		return nil, false, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	localPort, err := parsePort(localPortValue)
	if err != nil {
		return nil, false, fmt.Errorf("TUNNEL_LOCAL_PORT must be a valid port number (1-65535)")
	}

	caCert, err := readOptionalPEM(getenv, readFile, "TUNNEL_CA_CERT", "TUNNEL_CA_CERT_FILE")
	if err != nil {
		return nil, false, err
	}
	clientCert, err := readOptionalPEM(getenv, readFile, "TUNNEL_CLIENT_CERT", "TUNNEL_CLIENT_CERT_FILE")
	if err != nil {
		return nil, false, err
	}
	clientKey, err := readOptionalPEM(getenv, readFile, "TUNNEL_CLIENT_KEY", "TUNNEL_CLIENT_KEY_FILE")
	if err != nil {
		return nil, false, err
	}

	return &tunnelConfig{
		ServerURL:        serverURL,
		Token:            token,
		GatewayID:        gatewayID,
		CACert:           caCert,
		ClientCert:       clientCert,
		ClientKey:        clientKey,
		AgentVersion:     envOrDefault(getenv, "TUNNEL_AGENT_VERSION", defaultAgentVersion),
		PingInterval:     envDurationMS(getenv, "TUNNEL_PING_INTERVAL_MS", 15*time.Second),
		ReconnectInitial: envDurationMS(getenv, "TUNNEL_RECONNECT_INITIAL_MS", time.Second),
		ReconnectMax:     envDurationMS(getenv, "TUNNEL_RECONNECT_MAX_MS", time.Minute),
		LocalServiceHost: envOrDefault(getenv, "TUNNEL_LOCAL_HOST", "127.0.0.1"),
		LocalServicePort: localPort,
	}, false, nil
}

func readOptionalPEM(getenv envLookup, readFile fileReader, inlineKey, fileKey string) (string, error) {
	if inline := strings.TrimSpace(getenv(inlineKey)); inline != "" {
		return inline, nil
	}

	filePath := strings.TrimSpace(getenv(fileKey))
	if filePath == "" {
		return "", nil
	}

	contents, err := readFile(filePath)
	if err != nil {
		return "", fmt.Errorf("failed to read %s from %s: %w", inlineKey, filePath, err)
	}
	return strings.TrimSpace(string(contents)), nil
}

func parsePort(value string) (int, error) {
	port, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || port < 1 || port > 65535 {
		return 0, fmt.Errorf("invalid port")
	}
	return port, nil
}

func envOrDefault(getenv envLookup, key, fallback string) string {
	if value := strings.TrimSpace(getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envDurationMS(getenv envLookup, key string, fallback time.Duration) time.Duration {
	value := strings.TrimSpace(getenv(key))
	if value == "" {
		return fallback
	}
	ms, err := strconv.Atoi(value)
	if err != nil || ms <= 0 {
		return fallback
	}
	return time.Duration(ms) * time.Millisecond
}
