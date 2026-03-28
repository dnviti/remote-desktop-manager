// Package main implements the SSH gateway gRPC key management server.
// Replaces the Node.js HTTPS key-api-server.js with a static Go binary
// using mTLS for authentication (no bearer tokens).
package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"log"
	"net"
	"os"
	"os/signal"
	"strings"
	"syscall"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
)

const (
	defaultPort        = "9022"
	authorizedKeysPath = "/tmp/.ssh/authorized_keys"
	configKeysPath     = "/config/authorized_keys"
)

// keyManagementServer implements the KeyManagement gRPC service.
type keyManagementServer struct {
	UnimplementedKeyManagementServer
}

func (s *keyManagementServer) PushKey(_ context.Context, req *PushKeyRequest) (*PushKeyResponse, error) {
	if req.PublicKey == "" {
		return &PushKeyResponse{Ok: false, Message: "missing public_key"}, nil
	}

	// Validate key format (same check as the old key-api-server.js)
	if !strings.HasPrefix(req.PublicKey, "ssh-") && !strings.HasPrefix(req.PublicKey, "ecdsa-") {
		return &PushKeyResponse{Ok: false, Message: "invalid key format"}, nil
	}

	// Write key to authorized_keys (overwrite, same as old API)
	content := req.PublicKey + "\n"
	if err := os.WriteFile(authorizedKeysPath, []byte(content), 0600); err != nil {
		log.Printf("[key-mgmt] failed to write authorized_keys: %v", err)
		return &PushKeyResponse{Ok: false, Message: "failed to write key"}, nil
	}

	// Also write to /config/authorized_keys for persistence across restarts
	if err := os.WriteFile(configKeysPath, []byte(content), 0600); err != nil {
		log.Printf("[key-mgmt] warning: failed to write config authorized_keys: %v", err)
		// Non-fatal — the primary path succeeded
	}

	log.Printf("[key-mgmt] PushKey: key written (%d bytes)", len(req.PublicKey))
	return &PushKeyResponse{Ok: true, Message: "key pushed"}, nil
}

func (s *keyManagementServer) GetKeys(_ context.Context, _ *GetKeysRequest) (*GetKeysResponse, error) {
	data, err := os.ReadFile(authorizedKeysPath)
	if err != nil {
		if os.IsNotExist(err) {
			return &GetKeysResponse{Keys: []string{}}, nil
		}
		log.Printf("[key-mgmt] failed to read authorized_keys: %v", err)
		return &GetKeysResponse{Keys: []string{}}, nil
	}

	var keys []string
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line != "" {
			keys = append(keys, line)
		}
	}

	log.Printf("[key-mgmt] GetKeys: returning %d keys", len(keys))
	return &GetKeysResponse{Keys: keys}, nil
}

func buildServerTLSConfig(expectedSPIFFEID string) *tls.Config {
	caPath := os.Getenv("GATEWAY_GRPC_TLS_CA")
	clientCAPath := os.Getenv("GATEWAY_GRPC_CLIENT_CA")
	if clientCAPath == "" {
		clientCAPath = caPath
	}
	certPath := os.Getenv("GATEWAY_GRPC_TLS_CERT")
	keyPath := os.Getenv("GATEWAY_GRPC_TLS_KEY")

	if caPath == "" || clientCAPath == "" || certPath == "" || keyPath == "" {
		return nil
	}

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		log.Fatalf("[tls] failed to load cert/key (%s, %s): %v", certPath, keyPath, err)
	}

	clientCAPEM, err := os.ReadFile(clientCAPath)
	if err != nil {
		log.Fatalf("[tls] failed to read client CA %s: %v", clientCAPath, err)
	}

	clientCAPool := x509.NewCertPool()
	if !clientCAPool.AppendCertsFromPEM(clientCAPEM) {
		log.Fatalf("[tls] failed to parse client CA from %s", clientCAPath)
	}

	tlsConfig := &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAnyClientCert,
		ClientCAs:    clientCAPool,
		MinVersion:   tls.VersionTLS12,
	}

	tlsConfig.VerifyPeerCertificate = func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
		if len(rawCerts) == 0 {
			return fmt.Errorf("no client certificate presented")
		}

		certs := make([]*x509.Certificate, 0, len(rawCerts))
		for _, rawCert := range rawCerts {
			parsed, parseErr := x509.ParseCertificate(rawCert)
			if parseErr != nil {
				return fmt.Errorf("failed to parse client certificate: %w", parseErr)
			}
			certs = append(certs, parsed)
		}

		verifyOpts := x509.VerifyOptions{
			Roots:     clientCAPool,
			KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageClientAuth},
		}
		if len(certs) > 1 {
			verifyOpts.Intermediates = x509.NewCertPool()
			for _, intermediate := range certs[1:] {
				verifyOpts.Intermediates.AddCert(intermediate)
			}
		}

		if _, verifyErr := certs[0].Verify(verifyOpts); verifyErr != nil {
			return fmt.Errorf("client certificate verification failed: %w", verifyErr)
		}

		if expectedSPIFFEID == "" {
			return nil
		}

		clientSPIFFEID, err := extractSPIFFEID(certs[0])
		if err != nil {
			return err
		}
		if !spiffeIDEqual(clientSPIFFEID, expectedSPIFFEID) {
			log.Printf("[tls] rejected client SPIFFE ID=%q (expected %q)", clientSPIFFEID, expectedSPIFFEID)
			return fmt.Errorf("client SPIFFE ID %q not allowed", clientSPIFFEID)
		}

		return nil
	}

	return tlsConfig
}

func main() {
	port := os.Getenv("GATEWAY_GRPC_PORT")
	if port == "" {
		port = defaultPort
	}

	var grpcOpts []grpc.ServerOption
	trustDomain := os.Getenv("SPIFFE_TRUST_DOMAIN")
	if trustDomain == "" {
		trustDomain = "arsenale.local"
	}
	expectedSPIFFEID := os.Getenv("GATEWAY_GRPC_EXPECTED_SPIFFE_ID")
	if expectedSPIFFEID == "" {
		expectedSPIFFEID = buildServiceSPIFFEID(trustDomain, "server")
	}

	if tlsConfig := buildServerTLSConfig(expectedSPIFFEID); tlsConfig != nil {
		grpcOpts = append(grpcOpts, grpc.Creds(credentials.NewTLS(tlsConfig)))
		log.Printf("[main] gRPC server using mTLS (explicit client certificate verification)")
	} else {
		log.Println("[main] WARNING: gRPC server using INSECURE plaintext — set GATEWAY_GRPC_TLS_CA/CERT/KEY to enable mTLS")
	}

	if expectedSPIFFEID != "" {
		log.Printf("[main] enforcing client SPIFFE ID=%q", expectedSPIFFEID)
	}

	grpcServer := grpc.NewServer(grpcOpts...)
	RegisterKeyManagementServer(grpcServer, &keyManagementServer{})

	addr := "0.0.0.0:" + port
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		log.Fatalf("[main] failed to listen on %s: %v", addr, err)
	}
	defer lis.Close()

	log.Printf("[main] Key management gRPC server listening on %s", addr)

	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			log.Printf("[main] gRPC server error: %v", err)
		}
	}()

	// Graceful shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh

	log.Println("[main] shutting down gRPC server...")
	grpcServer.GracefulStop()
	log.Println("[main] shutdown complete")
}
