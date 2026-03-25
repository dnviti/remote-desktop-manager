package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"testing"
	"time"
)

// generateTestCA creates a self-signed CA certificate and returns the PEM-encoded
// cert and key.
func generateTestCA(t *testing.T) (certPEM, keyPEM string) {
	t.Helper()

	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Test CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		t.Fatalf("create CA cert: %v", err)
	}

	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))

	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		t.Fatalf("marshal CA key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))

	return certPEM, keyPEM
}

// generateTestClientCert creates a client certificate signed by the given CA and
// returns the PEM-encoded cert and key.
func generateTestClientCert(t *testing.T, caCertPEM, caKeyPEM string) (certPEM, keyPEM string) {
	t.Helper()

	// Parse CA cert and key.
	caBlock, _ := pem.Decode([]byte(caCertPEM))
	caCert, err := x509.ParseCertificate(caBlock.Bytes)
	if err != nil {
		t.Fatalf("parse CA cert: %v", err)
	}

	caKeyBlock, _ := pem.Decode([]byte(caKeyPEM))
	caKey, err := x509.ParseECPrivateKey(caKeyBlock.Bytes)
	if err != nil {
		t.Fatalf("parse CA key: %v", err)
	}

	// Generate client key pair.
	clientKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate client key: %v", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "Test Client"},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &clientKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create client cert: %v", err)
	}

	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))

	keyDER, err := x509.MarshalECPrivateKey(clientKey)
	if err != nil {
		t.Fatalf("marshal client key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))

	return certPEM, keyPEM
}

func TestBuildTLSConfig(t *testing.T) {
	caCertPEM, caKeyPEM := generateTestCA(t)
	clientCertPEM, clientKeyPEM := generateTestClientCert(t, caCertPEM, caKeyPEM)

	tests := []struct {
		name       string
		caCert     string
		clientCert string
		clientKey  string
		wantErr    bool
		check      func(t *testing.T, cfg *tls.Config)
	}{
		{
			name:       "full mTLS with CA and client cert",
			caCert:     caCertPEM,
			clientCert: clientCertPEM,
			clientKey:  clientKeyPEM,
			wantErr:    false,
			check: func(t *testing.T, cfg *tls.Config) {
				if cfg.RootCAs == nil {
					t.Error("expected RootCAs to be set")
				}
				if len(cfg.Certificates) != 1 {
					t.Errorf("expected 1 client certificate, got %d", len(cfg.Certificates))
				}
			},
		},
		{
			name:       "CA cert only without client cert",
			caCert:     caCertPEM,
			clientCert: "",
			clientKey:  "",
			wantErr:    false,
			check: func(t *testing.T, cfg *tls.Config) {
				if cfg.RootCAs == nil {
					t.Error("expected RootCAs to be set")
				}
				if len(cfg.Certificates) != 0 {
					t.Errorf("expected no client certificates, got %d", len(cfg.Certificates))
				}
			},
		},
		{
			name:       "no certificates uses system defaults",
			caCert:     "",
			clientCert: "",
			clientKey:  "",
			wantErr:    false,
			check: func(t *testing.T, cfg *tls.Config) {
				if cfg.RootCAs != nil {
					t.Error("expected RootCAs to be nil for system roots")
				}
				if len(cfg.Certificates) != 0 {
					t.Errorf("expected no client certificates, got %d", len(cfg.Certificates))
				}
			},
		},
		{
			name:       "invalid CA PEM returns error",
			caCert:     "not-a-valid-pem",
			clientCert: "",
			clientKey:  "",
			wantErr:    true,
		},
		{
			name:       "invalid client cert PEM returns error",
			caCert:     "",
			clientCert: "not-valid-cert",
			clientKey:  "not-valid-key",
			wantErr:    true,
		},
		{
			name:       "mismatched client cert and key returns error",
			caCert:     "",
			clientCert: clientCertPEM,
			clientKey:  caKeyPEM, // wrong key
			wantErr:    true,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := BuildTLSConfig(tt.caCert, tt.clientCert, tt.clientKey)
			if tt.wantErr {
				if err == nil {
					t.Fatal("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if tt.check != nil {
				tt.check(t, cfg)
			}
		})
	}
}

func TestBuildTLSConfigMinVersion(t *testing.T) {
	cfg, err := BuildTLSConfig("", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.MinVersion != tls.VersionTLS12 {
		t.Errorf("MinVersion: got %d, want %d (TLS 1.2)", cfg.MinVersion, tls.VersionTLS12)
	}
}

func TestBuildTLSConfigInsecureSkipVerify(t *testing.T) {
	cfg, err := BuildTLSConfig("", "", "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.InsecureSkipVerify {
		t.Error("InsecureSkipVerify should be false")
	}
}
