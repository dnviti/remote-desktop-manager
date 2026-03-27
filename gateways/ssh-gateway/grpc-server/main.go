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
	"google.golang.org/grpc/peer"
)

const (
	defaultPort         = "9022"
	authorizedKeysPath  = "/tmp/.ssh/authorized_keys"
	configKeysPath      = "/config/authorized_keys"
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

func buildServerTLSConfig() *tls.Config {
	caPath := os.Getenv("GATEWAY_GRPC_TLS_CA")
	certPath := os.Getenv("GATEWAY_GRPC_TLS_CERT")
	keyPath := os.Getenv("GATEWAY_GRPC_TLS_KEY")

	if caPath == "" || certPath == "" || keyPath == "" {
		return nil
	}

	cert, err := tls.LoadX509KeyPair(certPath, keyPath)
	if err != nil {
		log.Fatalf("[tls] failed to load cert/key (%s, %s): %v", certPath, keyPath, err)
	}

	caPEM, err := os.ReadFile(caPath)
	if err != nil {
		log.Fatalf("[tls] failed to read CA %s: %v", caPath, err)
	}

	caPool := x509.NewCertPool()
	if !caPool.AppendCertsFromPEM(caPEM) {
		log.Fatalf("[tls] failed to parse CA from %s", caPath)
	}

	return &tls.Config{
		Certificates: []tls.Certificate{cert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    caPool,
		MinVersion:   tls.VersionTLS12,
	}
}

// cnVerifyInterceptor optionally verifies the client certificate CN.
func cnVerifyInterceptor(expectedCN string) grpc.UnaryServerInterceptor {
	return func(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
		if expectedCN == "" {
			return handler(ctx, req)
		}
		p, ok := peer.FromContext(ctx)
		if !ok {
			return nil, fmt.Errorf("no peer info in context")
		}
		tlsInfo, ok := p.AuthInfo.(credentials.TLSInfo)
		if !ok {
			return nil, fmt.Errorf("no TLS info in peer")
		}
		if len(tlsInfo.State.VerifiedChains) == 0 || len(tlsInfo.State.VerifiedChains[0]) == 0 {
			return nil, fmt.Errorf("no verified client certificate")
		}
		clientCN := tlsInfo.State.VerifiedChains[0][0].Subject.CommonName
		if clientCN != expectedCN {
			log.Printf("[tls] rejected client CN=%q (expected %q)", clientCN, expectedCN)
			return nil, fmt.Errorf("client CN %q not allowed", clientCN)
		}
		return handler(ctx, req)
	}
}

func main() {
	port := os.Getenv("GATEWAY_GRPC_PORT")
	if port == "" {
		port = defaultPort
	}

	var grpcOpts []grpc.ServerOption

	if tlsConfig := buildServerTLSConfig(); tlsConfig != nil {
		grpcOpts = append(grpcOpts, grpc.Creds(credentials.NewTLS(tlsConfig)))
		log.Printf("[main] gRPC server using mTLS (RequireAndVerifyClientCert)")
	} else {
		log.Println("[main] WARNING: gRPC server using INSECURE plaintext — set GATEWAY_GRPC_TLS_CA/CERT/KEY to enable mTLS")
	}

	// Optional CN verification
	if expectedCN := os.Getenv("GATEWAY_GRPC_EXPECTED_CN"); expectedCN != "" {
		grpcOpts = append(grpcOpts, grpc.UnaryInterceptor(cnVerifyInterceptor(expectedCN)))
		log.Printf("[main] enforcing client CN=%q", expectedCN)
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
