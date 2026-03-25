// Package auth provides authentication and TLS utilities for Arsenale gateway
// agents connecting to the TunnelBroker server.
package auth

import (
	"crypto/tls"
	"crypto/x509"
	"fmt"
)

// BuildTLSConfig constructs a *tls.Config for mTLS communication with the
// TunnelBroker. All parameters are PEM-encoded strings (not file paths).
//
// - caCert: CA certificate for server verification (optional, empty = system roots)
// - clientCert + clientKey: client certificate for mutual TLS (optional, both must be set or both empty)
func BuildTLSConfig(caCert, clientCert, clientKey string) (*tls.Config, error) {
	cfg := &tls.Config{
		MinVersion: tls.VersionTLS12,
	}

	// Add CA certificate for server verification.
	if caCert != "" {
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM([]byte(caCert)) {
			return nil, fmt.Errorf("failed to parse CA certificate")
		}
		cfg.RootCAs = pool
	}

	// Add client certificate for mTLS.
	if clientCert != "" && clientKey != "" {
		cert, err := tls.X509KeyPair([]byte(clientCert), []byte(clientKey))
		if err != nil {
			return nil, fmt.Errorf("loading client certificate: %w", err)
		}
		cfg.Certificates = []tls.Certificate{cert}
	}

	return cfg, nil
}
