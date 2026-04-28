package main

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

func buildAuthHeaders(cfg *tunnelConfig) http.Header {
	headers := http.Header{}
	headers.Set("Authorization", "Bearer "+cfg.Token)
	headers.Set("X-Gateway-Id", cfg.GatewayID)
	headers.Set("X-Agent-Version", cfg.AgentVersion)
	if strings.TrimSpace(cfg.ClientCert) != "" {
		headers.Set("X-Client-Cert", url.QueryEscape(cfg.ClientCert))
	}
	return headers
}

func buildTLSConfig(cfg *tunnelConfig) (*tls.Config, error) {
	if strings.TrimSpace(cfg.CACert) == "" && (strings.TrimSpace(cfg.ClientCert) == "" || strings.TrimSpace(cfg.ClientKey) == "") {
		return nil, nil
	}

	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if strings.TrimSpace(cfg.CACert) != "" {
		roots := x509.NewCertPool()
		if !roots.AppendCertsFromPEM([]byte(cfg.CACert)) {
			return nil, fmt.Errorf("parse TUNNEL_CA_CERT")
		}
		tlsConfig.RootCAs = roots
	}

	if strings.TrimSpace(cfg.ClientCert) != "" && strings.TrimSpace(cfg.ClientKey) != "" {
		cert, err := tls.X509KeyPair([]byte(cfg.ClientCert), []byte(cfg.ClientKey))
		if err != nil {
			return nil, fmt.Errorf("parse tunnel client certificate: %w", err)
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}

func buildDialer(cfg *tunnelConfig) (*websocket.Dialer, error) {
	tlsConfig, err := buildTLSConfig(cfg)
	if err != nil {
		return nil, err
	}

	dialer := *websocket.DefaultDialer
	dialer.HandshakeTimeout = 10 * time.Second
	dialer.TLSClientConfig = tlsConfig
	return &dialer, nil
}
