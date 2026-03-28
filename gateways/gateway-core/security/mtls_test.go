package security

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"net/url"
	"testing"
	"time"
)

// generateTestCA creates a self-signed CA certificate and returns PEM-encoded
// cert and private key.
func generateTestCA(t *testing.T) (certPEM, keyPEM string, cert *x509.Certificate, key ed25519.PrivateKey) {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate CA key: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(1),
		Subject: pkix.Name{
			CommonName:   "Arsenale Test CA",
			Organization: []string{"Arsenale Test"},
		},
		NotBefore:             time.Now().Add(-1 * time.Hour),
		NotAfter:              time.Now().Add(24 * time.Hour),
		KeyUsage:              x509.KeyUsageCertSign | x509.KeyUsageCRLSign,
		BasicConstraintsValid: true,
		IsCA:                  true,
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, template, pub, priv)
	if err != nil {
		t.Fatalf("create CA cert: %v", err)
	}

	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes}))

	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal CA key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes}))

	parsedCert, err := x509.ParseCertificate(derBytes)
	if err != nil {
		t.Fatalf("parse CA cert: %v", err)
	}

	return certPEM, keyPEM, parsedCert, priv
}

// generateTestClientCert creates a client certificate signed by the given CA
// with a SPIFFE URI SAN for the gateway.
func generateTestClientCert(t *testing.T, caCert *x509.Certificate, caKey ed25519.PrivateKey, gatewayID string, notAfter time.Time) (certPEM, keyPEM string) {
	t.Helper()

	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatalf("generate client key: %v", err)
	}

	spiffeID, err := url.Parse(BuildGatewaySPIFFEID("arsenale.local", gatewayID))
	if err != nil {
		t.Fatalf("parse SPIFFE ID: %v", err)
	}

	template := &x509.Certificate{
		SerialNumber: big.NewInt(2),
		Subject: pkix.Name{
			CommonName:   gatewayID,
			Organization: []string{"Arsenale Test"},
		},
		NotBefore: time.Now().Add(-1 * time.Hour),
		NotAfter:  notAfter,
		KeyUsage:  x509.KeyUsageDigitalSignature,
		ExtKeyUsage: []x509.ExtKeyUsage{
			x509.ExtKeyUsageClientAuth,
		},
		URIs: []*url.URL{spiffeID},
	}

	derBytes, err := x509.CreateCertificate(rand.Reader, template, caCert, pub, caKey)
	if err != nil {
		t.Fatalf("create client cert: %v", err)
	}

	certPEM = string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes}))

	privBytes, err := x509.MarshalPKCS8PrivateKey(priv)
	if err != nil {
		t.Fatalf("marshal client key: %v", err)
	}
	keyPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privBytes}))

	return certPEM, keyPEM
}

func TestValidateCertChain_Valid(t *testing.T) {
	caPEM, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	if err := ValidateCertChain(caPEM, clientPEM); err != nil {
		t.Fatalf("expected valid chain, got: %v", err)
	}
}

func TestValidateCertChain_WrongCA(t *testing.T) {
	_, _, caCert, caKey := generateTestCA(t)
	otherCAPEM, _, _, _ := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	err := ValidateCertChain(otherCAPEM, clientPEM)
	if err == nil {
		t.Fatal("expected error for wrong CA, got nil")
	}
}

func TestValidateCertChain_ExpiredCert(t *testing.T) {
	caPEM, _, caCert, caKey := generateTestCA(t)
	// Cert expired 1 hour ago.
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(-1*time.Hour))

	err := ValidateCertChain(caPEM, clientPEM)
	if err == nil {
		t.Fatal("expected error for expired cert, got nil")
	}
}

func TestComputeCACertFingerprint_Deterministic(t *testing.T) {
	caPEM, _, _, _ := generateTestCA(t)

	fp1, err := ComputeCACertFingerprint(caPEM)
	if err != nil {
		t.Fatalf("first call: %v", err)
	}

	fp2, err := ComputeCACertFingerprint(caPEM)
	if err != nil {
		t.Fatalf("second call: %v", err)
	}

	if fp1 != fp2 {
		t.Fatalf("fingerprints not deterministic: %q vs %q", fp1, fp2)
	}

	if len(fp1) != 64 { // SHA-256 = 32 bytes = 64 hex chars
		t.Fatalf("unexpected fingerprint length: %d", len(fp1))
	}
}

func TestVerifyCACertFingerprint_Match(t *testing.T) {
	caPEM, _, _, _ := generateTestCA(t)

	fp, err := ComputeCACertFingerprint(caPEM)
	if err != nil {
		t.Fatalf("compute fingerprint: %v", err)
	}

	if err := VerifyCACertFingerprint(caPEM, fp); err != nil {
		t.Fatalf("expected match, got: %v", err)
	}
}

func TestVerifyCACertFingerprint_Mismatch(t *testing.T) {
	caPEM, _, _, _ := generateTestCA(t)

	err := VerifyCACertFingerprint(caPEM, "0000000000000000000000000000000000000000000000000000000000000000")
	if err == nil {
		t.Fatal("expected error for fingerprint mismatch, got nil")
	}
}

func TestVerifyGatewayIdentity_CorrectSPIFFEID(t *testing.T) {
	_, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	if err := VerifyGatewayIdentity(clientPEM, BuildGatewaySPIFFEID("arsenale.local", "gateway-001")); err != nil {
		t.Fatalf("expected match, got: %v", err)
	}
}

func TestVerifyGatewayIdentity_WrongSPIFFEID(t *testing.T) {
	_, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	err := VerifyGatewayIdentity(clientPEM, BuildGatewaySPIFFEID("arsenale.local", "gateway-999"))
	if err == nil {
		t.Fatal("expected error for wrong SPIFFE ID, got nil")
	}
}

func TestValidateConnectionForCredentialPush_NilState(t *testing.T) {
	err := ValidateConnectionForCredentialPush(nil, BuildGatewaySPIFFEID("arsenale.local", "gateway-001"))
	if err == nil {
		t.Fatal("expected error for nil TLS state, got nil")
	}
}

func TestValidateConnectionForCredentialPush_NoHandshake(t *testing.T) {
	state := &tls.ConnectionState{
		HandshakeComplete: false,
	}
	err := ValidateConnectionForCredentialPush(state, BuildGatewaySPIFFEID("arsenale.local", "gateway-001"))
	if err == nil {
		t.Fatal("expected error for incomplete handshake, got nil")
	}
}

func TestValidateConnectionForCredentialPush_NoPeerCerts(t *testing.T) {
	state := &tls.ConnectionState{
		HandshakeComplete: true,
		PeerCertificates:  []*x509.Certificate{},
	}
	err := ValidateConnectionForCredentialPush(state, BuildGatewaySPIFFEID("arsenale.local", "gateway-001"))
	if err == nil {
		t.Fatal("expected error for no peer certs, got nil")
	}
}

func TestValidateConnectionForCredentialPush_WrongSPIFFEID(t *testing.T) {
	spiffeID, err := url.Parse(BuildGatewaySPIFFEID("arsenale.local", "gateway-001"))
	if err != nil {
		t.Fatalf("parse SPIFFE ID: %v", err)
	}
	cert := &x509.Certificate{
		URIs: []*url.URL{spiffeID},
	}
	state := &tls.ConnectionState{
		HandshakeComplete: true,
		PeerCertificates:  []*x509.Certificate{cert},
	}
	err = ValidateConnectionForCredentialPush(state, BuildGatewaySPIFFEID("arsenale.local", "gateway-999"))
	if err == nil {
		t.Fatal("expected error for wrong SPIFFE ID, got nil")
	}
}

func TestValidateConnectionForCredentialPush_Valid(t *testing.T) {
	spiffeID, err := url.Parse(BuildGatewaySPIFFEID("arsenale.local", "gateway-001"))
	if err != nil {
		t.Fatalf("parse SPIFFE ID: %v", err)
	}
	cert := &x509.Certificate{
		URIs: []*url.URL{spiffeID},
	}
	state := &tls.ConnectionState{
		HandshakeComplete: true,
		PeerCertificates:  []*x509.Certificate{cert},
	}
	if err := ValidateConnectionForCredentialPush(state, BuildGatewaySPIFFEID("arsenale.local", "gateway-001")); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestMustValidateMTLS_FullPass(t *testing.T) {
	caPEM, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	fp, err := ComputeCACertFingerprint(caPEM)
	if err != nil {
		t.Fatalf("compute fingerprint: %v", err)
	}

	err = MustValidateMTLS(MTLSConfig{
		CACertPEM:           caPEM,
		ClientCertPEM:       clientPEM,
		ExpectedSPIFFEID:    BuildGatewaySPIFFEID("arsenale.local", "gateway-001"),
		ExpectedFingerprint: fp,
	})
	if err != nil {
		t.Fatalf("expected full validation to pass, got: %v", err)
	}
}

func TestMustValidateMTLS_SkipFingerprint(t *testing.T) {
	caPEM, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(24*time.Hour))

	err := MustValidateMTLS(MTLSConfig{
		CACertPEM:        caPEM,
		ClientCertPEM:    clientPEM,
		ExpectedSPIFFEID: BuildGatewaySPIFFEID("arsenale.local", "gateway-001"),
	})
	if err != nil {
		t.Fatalf("expected validation without fingerprint to pass, got: %v", err)
	}
}

func TestMustValidateMTLS_ExpiredCert(t *testing.T) {
	caPEM, _, caCert, caKey := generateTestCA(t)
	clientPEM, _ := generateTestClientCert(t, caCert, caKey, "gateway-001", time.Now().Add(-1*time.Hour))

	err := MustValidateMTLS(MTLSConfig{
		CACertPEM:        caPEM,
		ClientCertPEM:    clientPEM,
		ExpectedSPIFFEID: BuildGatewaySPIFFEID("arsenale.local", "gateway-001"),
	})
	if err == nil {
		t.Fatal("expected error for expired cert in full validation, got nil")
	}
}
