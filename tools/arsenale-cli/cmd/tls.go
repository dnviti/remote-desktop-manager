package cmd

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func httpClientForConfig(cfg *CLIConfig) (*http.Client, error) {
	caCertPath, err := resolveCACertPath(cfg)
	if err != nil {
		return nil, err
	}
	if caCertPath == "" {
		return httpClient, nil
	}

	transport, err := transportWithCACert(caCertPath)
	if err != nil {
		return nil, fmt.Errorf("load CA certificate %s: %w", caCertPath, err)
	}

	return &http.Client{
		Timeout:   httpClient.Timeout,
		Transport: transport,
	}, nil
}

func resolveCACertPath(cfg *CLIConfig) (string, error) {
	if path := strings.TrimSpace(os.Getenv("ARSENALE_CA_CERT")); path != "" {
		if _, err := os.Stat(path); err != nil {
			return "", fmt.Errorf("stat ARSENALE_CA_CERT: %w", err)
		}
		return path, nil
	}

	return defaultDevCACertPath(cfg.ServerURL), nil
}

func defaultDevCACertPath(serverURL string) string {
	parsed, err := url.Parse(serverURL)
	if err != nil {
		return ""
	}
	if !strings.EqualFold(parsed.Scheme, "https") {
		return ""
	}

	host := strings.ToLower(parsed.Hostname())
	switch host {
	case "localhost", "127.0.0.1", "::1":
	default:
		return ""
	}

	path := filepath.Join(defaultDevStateHome(), "arsenale-dev", "dev-certs", "client", "ca.pem")
	if _, err := os.Stat(path); err != nil {
		return ""
	}
	return path
}

func defaultDevStateHome() string {
	if stateHome := strings.TrimSpace(os.Getenv("XDG_STATE_HOME")); stateHome != "" {
		return stateHome
	}

	home, err := os.UserHomeDir()
	if err != nil {
		return ""
	}
	return filepath.Join(home, ".local", "state")
}

func transportWithCACert(path string) (*http.Transport, error) {
	caPEM, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	pool, err := x509.SystemCertPool()
	if err != nil || pool == nil {
		pool = x509.NewCertPool()
	}
	if ok := pool.AppendCertsFromPEM(caPEM); !ok {
		return nil, fmt.Errorf("file does not contain a valid PEM certificate")
	}

	transport := http.DefaultTransport.(*http.Transport).Clone()
	tlsConfig := transport.TLSClientConfig
	if tlsConfig != nil {
		tlsConfig = tlsConfig.Clone()
	} else {
		tlsConfig = &tls.Config{}
	}
	tlsConfig.RootCAs = pool
	transport.TLSClientConfig = tlsConfig
	return transport, nil
}
