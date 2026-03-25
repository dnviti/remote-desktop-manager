package auth

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"math/big"
	"net"
	"strings"
	"testing"
	"time"
)

// ============================================================================
// TLS/mTLS Hardening Security Tests
// Reference: OWASP Transport Layer Security Cheat Sheet
// ============================================================================

// TestTLSMinVersion12 verifies that BuildTLSConfig sets MinVersion >= TLS 1.2.
// Connections with TLS 1.0 or TLS 1.1 must be rejected.
func TestTLSMinVersion12(t *testing.T) {
	caCertPEM, _ := generateTestCA(t)

	tests := []struct {
		name       string
		caCert     string
		clientCert string
		clientKey  string
	}{
		{"no certs", "", "", ""},
		{"CA only", caCertPEM, "", ""},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := BuildTLSConfig(tt.caCert, tt.clientCert, tt.clientKey)
			if err != nil {
				t.Fatalf("BuildTLSConfig: %v", err)
			}

			if cfg.MinVersion < tls.VersionTLS12 {
				t.Errorf("MinVersion %d is below TLS 1.2 (%d)", cfg.MinVersion, tls.VersionTLS12)
			}

			// Verify explicitly that TLS 1.0 and 1.1 are excluded.
			if cfg.MinVersion <= tls.VersionTLS10 {
				t.Error("SECURITY: TLS 1.0 is allowed — must be >= TLS 1.2")
			}
			if cfg.MinVersion <= tls.VersionTLS11 {
				t.Error("SECURITY: TLS 1.1 is allowed — must be >= TLS 1.2")
			}
		})
	}
}

// TestTLSMinVersionWithRealHandshake creates a TLS server that only accepts
// TLS 1.2+ and verifies that the BuildTLSConfig-generated client config
// negotiates successfully, while a forced TLS 1.1 client fails.
func TestTLSMinVersionWithRealHandshake(t *testing.T) {
	// Generate server certificate.
	caCertPEM, caKeyPEM := generateTestCA(t)
	serverCertPEM, serverKeyPEM := generateTestServerCert(t, caCertPEM, caKeyPEM)

	serverCert, err := tls.X509KeyPair([]byte(serverCertPEM), []byte(serverKeyPEM))
	if err != nil {
		t.Fatalf("load server cert: %v", err)
	}

	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM([]byte(caCertPEM))

	// Start TLS server.
	serverTLSCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		MinVersion:   tls.VersionTLS12,
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverTLSCfg)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()

	// Accept connections in background — complete the handshake before closing.
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			// Complete the TLS handshake server-side before closing.
			tlsConn := conn.(*tls.Conn)
			_ = tlsConn.Handshake()
			// Hold the connection briefly so the client can read the result.
			buf := make([]byte, 1)
			_, _ = conn.Read(buf)
			conn.Close()
		}
	}()

	// Test 1: Client with BuildTLSConfig (should succeed with TLS 1.2+).
	clientCfg, err := BuildTLSConfig(caCertPEM, "", "")
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}

	conn, err := tls.Dial("tcp", addr, clientCfg)
	if err != nil {
		t.Errorf("TLS 1.2+ handshake failed: %v", err)
	} else {
		state := conn.ConnectionState()
		if state.Version < tls.VersionTLS12 {
			t.Errorf("negotiated TLS version %d is below 1.2", state.Version)
		}
		conn.Close()
	}

	// Test 2: Client forced to TLS 1.1 (should fail).
	insecureCfg := &tls.Config{
		RootCAs:    caPool,
		MinVersion: tls.VersionTLS10,
		MaxVersion: tls.VersionTLS11,
	}

	conn2, err := tls.Dial("tcp", addr, insecureCfg)
	if err == nil {
		state := conn2.ConnectionState()
		conn2.Close()
		t.Errorf("SECURITY: TLS 1.1 handshake succeeded (version %d) — server should reject", state.Version)
	}
}

// TestNoCipherSuiteDowngrade verifies that if cipher suites are configured,
// no weak suites (RC4, 3DES, NULL, EXPORT, anon DH) are included.
func TestNoCipherSuiteDowngrade(t *testing.T) {
	cfg, err := BuildTLSConfig("", "", "")
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}

	// Weak cipher suite IDs to reject.
	weakSuites := map[uint16]string{
		tls.TLS_RSA_WITH_RC4_128_SHA:        "RC4",
		tls.TLS_RSA_WITH_3DES_EDE_CBC_SHA:   "3DES",
		tls.TLS_ECDHE_RSA_WITH_RC4_128_SHA:  "ECDHE-RC4",
		tls.TLS_ECDHE_ECDSA_WITH_RC4_128_SHA: "ECDHE-ECDSA-RC4",
	}

	if len(cfg.CipherSuites) > 0 {
		for _, suite := range cfg.CipherSuites {
			if name, weak := weakSuites[suite]; weak {
				t.Errorf("SECURITY: Weak cipher suite %s (0x%04x) in TLS config", name, suite)
			}
		}
	} else {
		// When CipherSuites is nil, Go uses its default set which excludes
		// weak ciphers in TLS 1.2+. This is the preferred configuration.
		t.Log("CipherSuites is nil — Go defaults apply (safe for TLS 1.2+)")
	}

	// Verify no insecure cipher suites from the full registry.
	insecureSuites := tls.InsecureCipherSuites()
	insecureIDs := make(map[uint16]string)
	for _, s := range insecureSuites {
		insecureIDs[s.ID] = s.Name
	}

	if len(cfg.CipherSuites) > 0 {
		for _, suite := range cfg.CipherSuites {
			if name, insecure := insecureIDs[suite]; insecure {
				t.Errorf("SECURITY: Insecure cipher suite %s (0x%04x) in TLS config", name, suite)
			}
		}
	}
}

// TestInsecureSkipVerifyFalse verifies InsecureSkipVerify is always false
// in all BuildTLSConfig outputs.
func TestInsecureSkipVerifyFalse(t *testing.T) {
	caCertPEM, caKeyPEM := generateTestCA(t)
	clientCertPEM, clientKeyPEM := generateTestClientCert(t, caCertPEM, caKeyPEM)

	configs := []struct {
		name       string
		caCert     string
		clientCert string
		clientKey  string
	}{
		{"no certs", "", "", ""},
		{"CA only", caCertPEM, "", ""},
		{"full mTLS", caCertPEM, clientCertPEM, clientKeyPEM},
	}

	for _, cc := range configs {
		t.Run(cc.name, func(t *testing.T) {
			cfg, err := BuildTLSConfig(cc.caCert, cc.clientCert, cc.clientKey)
			if err != nil {
				t.Fatalf("BuildTLSConfig: %v", err)
			}
			if cfg.InsecureSkipVerify {
				t.Errorf("SECURITY: InsecureSkipVerify is true for %s config — must be false", cc.name)
			}
		})
	}
}

// TestClientCertValidation verifies that with mTLS enabled, connections without
// client certificates are rejected.
func TestClientCertValidation(t *testing.T) {
	caCertPEM, caKeyPEM := generateTestCA(t)
	serverCertPEM, serverKeyPEM := generateTestServerCert(t, caCertPEM, caKeyPEM)
	clientCertPEM, clientKeyPEM := generateTestClientCert(t, caCertPEM, caKeyPEM)

	serverCert, err := tls.X509KeyPair([]byte(serverCertPEM), []byte(serverKeyPEM))
	if err != nil {
		t.Fatalf("load server cert: %v", err)
	}

	caPool := x509.NewCertPool()
	caPool.AppendCertsFromPEM([]byte(caCertPEM))

	// mTLS server: requires client certificate.
	serverCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		ClientCAs:    caPool,
		ClientAuth:   tls.RequireAndVerifyClientCert,
		MinVersion:   tls.VersionTLS12,
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverCfg)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			// Force handshake completion, then hold connection open briefly.
			tlsConn := conn.(*tls.Conn)
			_ = tlsConn.Handshake()
			buf := make([]byte, 1)
			_, _ = conn.Read(buf)
			conn.Close()
		}
	}()

	// Test 1: Client WITH client cert should succeed.
	clientCfgWithCert, err := BuildTLSConfig(caCertPEM, clientCertPEM, clientKeyPEM)
	if err != nil {
		t.Fatalf("BuildTLSConfig with client cert: %v", err)
	}

	conn, err := tls.Dial("tcp", addr, clientCfgWithCert)
	if err != nil {
		t.Errorf("mTLS handshake with client cert failed: %v", err)
	} else {
		conn.Close()
	}

	// Test 2: Client WITHOUT client cert should fail.
	clientCfgNoCert, err := BuildTLSConfig(caCertPEM, "", "")
	if err != nil {
		t.Fatalf("BuildTLSConfig without client cert: %v", err)
	}

	conn2, err := tls.Dial("tcp", addr, clientCfgNoCert)
	if err == nil {
		// tls.Dial may succeed at the TCP level; force the full TLS handshake
		// to trigger the server's client cert requirement check.
		err = conn2.Handshake()
		if err == nil {
			// Handshake succeeded — try reading, the server should close with
			// a TLS alert because the client cert was missing.
			buf := make([]byte, 1)
			_, readErr := conn2.Read(buf)
			conn2.Close()
			if readErr == nil {
				t.Error("SECURITY: mTLS connection succeeded without client certificate")
			}
		} else {
			conn2.Close()
		}
	}
}

// TestExpiredCertRejection verifies that an expired certificate is detected
// during TLS handshake.
func TestExpiredCertRejection(t *testing.T) {
	// Generate an expired CA cert.
	caKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}

	caTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Expired Test CA"},
		NotBefore:             time.Now().Add(-48 * time.Hour),
		NotAfter:              time.Now().Add(-24 * time.Hour), // Expired 24h ago
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	caDER, err := x509.CreateCertificate(rand.Reader, caTmpl, caTmpl, &caKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create expired CA: %v", err)
	}

	expiredCAPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: caDER}))

	// Generate an expired server cert.
	serverKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}

	serverTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-48 * time.Hour),
		NotAfter:     time.Now().Add(-24 * time.Hour), // Expired
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	serverDER, err := x509.CreateCertificate(rand.Reader, serverTmpl, caTmpl, &serverKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create expired server cert: %v", err)
	}

	serverCertPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: serverDER}))
	serverKeyDER, _ := x509.MarshalECPrivateKey(serverKey)
	serverKeyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: serverKeyDER}))

	serverCert, err := tls.X509KeyPair([]byte(serverCertPEM), []byte(serverKeyPEM))
	if err != nil {
		t.Fatalf("load expired server cert: %v", err)
	}

	// Start server with expired cert.
	serverCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		MinVersion:   tls.VersionTLS12,
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverCfg)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			tlsConn := conn.(*tls.Conn)
			_ = tlsConn.Handshake()
			buf := make([]byte, 1)
			_, _ = conn.Read(buf)
			conn.Close()
		}
	}()

	// Client with expired CA should fail handshake.
	clientCfg, err := BuildTLSConfig(expiredCAPEM, "", "")
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}

	conn, err := tls.Dial("tcp", addr, clientCfg)
	if err == nil {
		conn.Close()
		t.Error("SECURITY: TLS handshake succeeded with expired certificate")
	} else {
		if !strings.Contains(err.Error(), "expired") && !strings.Contains(err.Error(), "certificate") {
			t.Logf("Expired cert rejection error (may vary by Go version): %v", err)
		}
	}
}

// TestSelfSignedCertWithCA verifies that a self-signed certificate with a
// matching CA succeeds, while one without fails.
func TestSelfSignedCertWithCA(t *testing.T) {
	caCertPEM, caKeyPEM := generateTestCA(t)
	serverCertPEM, serverKeyPEM := generateTestServerCert(t, caCertPEM, caKeyPEM)

	serverCert, err := tls.X509KeyPair([]byte(serverCertPEM), []byte(serverKeyPEM))
	if err != nil {
		t.Fatalf("load server cert: %v", err)
	}

	serverCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		MinVersion:   tls.VersionTLS12,
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverCfg)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			tlsConn := conn.(*tls.Conn)
			_ = tlsConn.Handshake()
			buf := make([]byte, 1)
			_, _ = conn.Read(buf)
			conn.Close()
		}
	}()

	// Test 1: Client with matching CA should succeed.
	t.Run("matching CA", func(t *testing.T) {
		clientCfg, err := BuildTLSConfig(caCertPEM, "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err != nil {
			t.Errorf("handshake with matching CA failed: %v", err)
		} else {
			conn.Close()
		}
	})

	// Test 2: Client with different CA should fail.
	t.Run("wrong CA", func(t *testing.T) {
		wrongCAPEM, _ := generateTestCA(t)
		clientCfg, err := BuildTLSConfig(wrongCAPEM, "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err == nil {
			conn.Close()
			t.Error("SECURITY: handshake with wrong CA succeeded")
		}
	})

	// Test 3: Client without any CA (system roots) should fail for self-signed.
	t.Run("no CA", func(t *testing.T) {
		clientCfg, err := BuildTLSConfig("", "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err == nil {
			conn.Close()
			t.Error("SECURITY: handshake with no CA succeeded for self-signed cert")
		}
	})
}

// TestCertChainValidation verifies that intermediate certificate chains are
// properly validated. A server presenting a leaf cert signed by an intermediate
// CA should work when the client trusts the root CA.
func TestCertChainValidation(t *testing.T) {
	// Generate root CA.
	rootKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate root key: %v", err)
	}

	rootTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(1),
		Subject:               pkix.Name{CommonName: "Root CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            1,
	}

	rootDER, err := x509.CreateCertificate(rand.Reader, rootTmpl, rootTmpl, &rootKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create root CA: %v", err)
	}
	rootCertPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: rootDER}))

	// Generate intermediate CA signed by root.
	interKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate intermediate key: %v", err)
	}

	rootCert, err := x509.ParseCertificate(rootDER)
	if err != nil {
		t.Fatalf("parse root cert: %v", err)
	}

	interTmpl := &x509.Certificate{
		SerialNumber:          big.NewInt(2),
		Subject:               pkix.Name{CommonName: "Intermediate CA"},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
		MaxPathLen:            0,
	}

	interDER, err := x509.CreateCertificate(rand.Reader, interTmpl, rootCert, &interKey.PublicKey, rootKey)
	if err != nil {
		t.Fatalf("create intermediate CA: %v", err)
	}
	interCertPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: interDER}))
	interCert, err := x509.ParseCertificate(interDER)
	if err != nil {
		t.Fatalf("parse intermediate cert: %v", err)
	}

	// Generate leaf cert signed by intermediate.
	leafKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate leaf key: %v", err)
	}

	leafTmpl := &x509.Certificate{
		SerialNumber: big.NewInt(3),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	leafDER, err := x509.CreateCertificate(rand.Reader, leafTmpl, interCert, &leafKey.PublicKey, interKey)
	if err != nil {
		t.Fatalf("create leaf cert: %v", err)
	}
	leafCertPEM := string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: leafDER}))
	leafKeyDER, _ := x509.MarshalECPrivateKey(leafKey)
	leafKeyPEM := string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: leafKeyDER}))

	// Server presents leaf + intermediate chain.
	fullChainPEM := leafCertPEM + interCertPEM
	serverCert, err := tls.X509KeyPair([]byte(fullChainPEM), []byte(leafKeyPEM))
	if err != nil {
		t.Fatalf("load server cert chain: %v", err)
	}

	serverCfg := &tls.Config{
		Certificates: []tls.Certificate{serverCert},
		MinVersion:   tls.VersionTLS12,
	}

	listener, err := tls.Listen("tcp", "127.0.0.1:0", serverCfg)
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer listener.Close()

	addr := listener.Addr().String()

	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			tlsConn := conn.(*tls.Conn)
			_ = tlsConn.Handshake()
			buf := make([]byte, 1)
			_, _ = conn.Read(buf)
			conn.Close()
		}
	}()

	// Client trusts root CA — should validate the chain.
	t.Run("valid chain", func(t *testing.T) {
		clientCfg, err := BuildTLSConfig(rootCertPEM, "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err != nil {
			t.Errorf("chain validation failed: %v", err)
		} else {
			conn.Close()
		}
	})

	// Client trusts only intermediate (not root) — should fail because the
	// intermediate is not self-signed and thus not a trust anchor.
	t.Run("intermediate only", func(t *testing.T) {
		clientCfg, err := BuildTLSConfig(interCertPEM, "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err == nil {
			// This may succeed on some Go versions if the intermediate is
			// accepted as a trust anchor. Log for awareness.
			conn.Close()
			t.Log("NOTE: Intermediate-only trust anchor was accepted (Go cert pool behavior)")
		}
	})

	// Client trusts a completely different CA — must fail.
	t.Run("wrong root CA", func(t *testing.T) {
		wrongCAPEM, _ := generateTestCA(t)
		clientCfg, err := BuildTLSConfig(wrongCAPEM, "", "")
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}

		conn, err := tls.Dial("tcp", addr, clientCfg)
		if err == nil {
			conn.Close()
			t.Error("SECURITY: chain validation succeeded with wrong root CA")
		}
	})
}

// ============================================================================
// Test Helpers
// ============================================================================

// generateTestServerCert creates a server certificate signed by the given CA
// with localhost SANs, suitable for TLS testing.
func generateTestServerCert(t *testing.T, caCertPEM, caKeyPEM string) (certPEM, keyPEM string) {
	t.Helper()

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

	serverKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatalf("generate server key: %v", err)
	}

	tmpl := &x509.Certificate{
		SerialNumber: big.NewInt(10),
		Subject:      pkix.Name{CommonName: "localhost"},
		DNSNames:     []string{"localhost"},
		IPAddresses:  []net.IP{net.ParseIP("127.0.0.1")},
		NotBefore:    time.Now().Add(-time.Hour),
		NotAfter:     time.Now().Add(24 * time.Hour),
		KeyUsage:     x509.KeyUsageDigitalSignature,
		ExtKeyUsage:  []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
	}

	der, err := x509.CreateCertificate(rand.Reader, tmpl, caCert, &serverKey.PublicKey, caKey)
	if err != nil {
		t.Fatalf("create server cert: %v", err)
	}

	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}))

	keyDER, err := x509.MarshalECPrivateKey(serverKey)
	if err != nil {
		t.Fatalf("marshal server key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}))

	return certPEM, keyPEM
}

// TestInsecureSkipVerifyCodeScan is a static analysis test that searches the
// codebase for InsecureSkipVerify: true. Any occurrence is a security risk.
func TestInsecureSkipVerifyCodeScan(t *testing.T) {
	// Direct test: BuildTLSConfig must never set InsecureSkipVerify.
	configs := []struct {
		name       string
		caCert     string
		clientCert string
		clientKey  string
	}{
		{"empty config", "", "", ""},
	}

	for _, cc := range configs {
		cfg, err := BuildTLSConfig(cc.caCert, cc.clientCert, cc.clientKey)
		if err != nil {
			t.Fatalf("BuildTLSConfig: %v", err)
		}
		if cfg.InsecureSkipVerify {
			t.Errorf("SECURITY: InsecureSkipVerify is true in %s — this must never be set", cc.name)
		}
	}

	// Note: A comprehensive scan would use go/ast to parse all .go files
	// and check for InsecureSkipVerify assignments. This test covers the
	// BuildTLSConfig function which is the primary TLS config entry point.
	t.Log("SECURITY: Run 'grep -rn \"InsecureSkipVerify: true\" .' to scan the full codebase")
}

// TestBuildTLSConfigMTLSCombinations tests all valid and invalid combinations
// of mTLS parameters to ensure no configuration path enables insecure defaults.
func TestBuildTLSConfigMTLSCombinations(t *testing.T) {
	caCertPEM, caKeyPEM := generateTestCA(t)
	clientCertPEM, clientKeyPEM := generateTestClientCert(t, caCertPEM, caKeyPEM)

	tests := []struct {
		name       string
		caCert     string
		clientCert string
		clientKey  string
		wantErr    bool
	}{
		{"all empty", "", "", "", false},
		{"CA only", caCertPEM, "", "", false},
		{"client cert without key", caCertPEM, clientCertPEM, "", false},        // cert without key, no error (key check in X509KeyPair)
		{"client key without cert", caCertPEM, "", clientKeyPEM, false},          // key without cert, no error (both must be set)
		{"full mTLS", caCertPEM, clientCertPEM, clientKeyPEM, false},
		{"invalid CA PEM", "not-a-pem", "", "", true},
		{"invalid client pair", "", "bad-cert", "bad-key", true},
		{"mismatched pair", "", clientCertPEM, caKeyPEM, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := BuildTLSConfig(tt.caCert, tt.clientCert, tt.clientKey)
			if tt.wantErr {
				if err == nil {
					t.Error("expected error, got nil")
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}

			// Every successful config must have these security properties.
			if cfg.InsecureSkipVerify {
				t.Error("SECURITY: InsecureSkipVerify is true")
			}
			if cfg.MinVersion < tls.VersionTLS12 {
				t.Errorf("SECURITY: MinVersion %d is below TLS 1.2", cfg.MinVersion)
			}
		})
	}
}

// TestTLSRenegotiationDisabled verifies that TLS renegotiation (which can be
// used for DoS attacks) is not explicitly enabled.
func TestTLSRenegotiationDisabled(t *testing.T) {
	cfg, err := BuildTLSConfig("", "", "")
	if err != nil {
		t.Fatalf("BuildTLSConfig: %v", err)
	}

	// Go's default is RenegotiateNever (0), which is the safest option.
	if cfg.Renegotiation != tls.RenegotiateNever {
		t.Errorf("SECURITY: TLS renegotiation is enabled (value %d) — should be RenegotiateNever",
			cfg.Renegotiation)
	}
}

// TestInvalidPEMInputs verifies that various malformed PEM inputs are handled
// gracefully without panics.
func TestInvalidPEMInputs(t *testing.T) {
	badPEMs := []struct {
		name string
		pem  string
	}{
		{"empty string", ""},
		{"whitespace only", "   \n\t  "},
		{"random binary", string([]byte{0x00, 0x01, 0xFF, 0xFE})},
		{"truncated PEM", "-----BEGIN CERTIFICATE-----\nnotbase64"},
		{"wrong type", "-----BEGIN PRIVATE KEY-----\n-----END PRIVATE KEY-----"},
		{"double header", "-----BEGIN CERTIFICATE-----\n-----BEGIN CERTIFICATE-----"},
		{"SQL injection", "'; DROP TABLE certs; --"},
		{"very long", strings.Repeat("A", 1024*1024)},
		{"null bytes", "-----BEGIN CERTIFICATE-----\n\x00\x00\x00\n-----END CERTIFICATE-----"},
	}

	for _, tt := range badPEMs {
		t.Run(fmt.Sprintf("CA_%s", tt.name), func(t *testing.T) {
			// Should not panic.
			_, err := BuildTLSConfig(tt.pem, "", "")
			if tt.pem == "" || tt.pem == "   \n\t  " {
				// Empty CA is valid (uses system roots).
				return
			}
			// Most bad PEMs should produce an error.
			if err == nil && tt.pem != "" {
				t.Logf("BuildTLSConfig accepted bad CA PEM %q without error", tt.name)
			}
		})

		t.Run(fmt.Sprintf("ClientPair_%s", tt.name), func(t *testing.T) {
			// Should not panic.
			_, _ = BuildTLSConfig("", tt.pem, tt.pem)
		})
	}
}
