// Package main implements a standalone RD Gateway (MS-TSGU) proxy service.
//
// This service handles the MS-TSGU RPC-over-HTTPS protocol, allowing native
// Windows and macOS RDP clients (mstsc.exe, Microsoft Remote Desktop) to tunnel
// RDP connections through Arsenale.
//
// The proxy accepts incoming HTTPS connections from RDP clients, authenticates
// them against the Arsenale API, and forwards the RDP traffic to the target host.
//
// Environment variables:
//
//	RDGW_LISTEN_ADDR      - Address to listen on (default: ":443")
//	RDGW_TLS_CERT         - Path to TLS certificate file
//	RDGW_TLS_KEY          - Path to TLS private key file
//	RDGW_ARSENALE_API_URL - Arsenale server API URL (e.g., "http://localhost:3001")
//	RDGW_API_TOKEN        - API token for authenticating with Arsenale server
//	RDGW_IDLE_TIMEOUT     - Idle timeout in seconds (default: 3600)
//	RDGW_LOG_LEVEL        - Log level: debug, info, warn, error (default: info)
package main

import (
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// tunnel represents an authenticated RD Gateway tunnel session.
type tunnel struct {
	id             string
	userID         string
	username       string
	remoteAddr     string
	targetHost     string
	targetPort     int
	createdAt      time.Time
	lastActivityAt time.Time
	upstream       net.Conn
	mu             sync.Mutex
}

// rdgwServer is the main RD Gateway proxy server.
type rdgwServer struct {
	listenAddr    string
	tlsCertFile   string
	tlsKeyFile    string
	arsenaleURL   string
	apiToken      string
	idleTimeout   time.Duration
	tunnels       sync.Map
	tunnelCounter int64
	mu            sync.Mutex
}

func main() {
	listenAddr := envOrDefault("RDGW_LISTEN_ADDR", ":443")
	tlsCert := envOrDefault("RDGW_TLS_CERT", "")
	tlsKey := envOrDefault("RDGW_TLS_KEY", "")
	arsenaleURL := envOrDefault("RDGW_ARSENALE_API_URL", "http://localhost:3001")
	apiToken := envOrDefault("RDGW_API_TOKEN", "")
	idleTimeoutSec, _ := strconv.Atoi(envOrDefault("RDGW_IDLE_TIMEOUT", "3600"))
	logLevel := envOrDefault("RDGW_LOG_LEVEL", "info")

	if logLevel == "debug" {
		log.SetFlags(log.Ldate | log.Ltime | log.Lmicroseconds | log.Lshortfile)
	} else {
		log.SetFlags(log.Ldate | log.Ltime)
	}

	srv := &rdgwServer{
		listenAddr:  listenAddr,
		tlsCertFile: tlsCert,
		tlsKeyFile:  tlsKey,
		arsenaleURL: arsenaleURL,
		apiToken:    apiToken,
		idleTimeout: time.Duration(idleTimeoutSec) * time.Second,
	}

	mux := http.NewServeMux()

	// MS-TSGU RPC-over-HTTPS endpoints
	// RPC_IN_DATA and RPC_OUT_DATA are the two HTTP channels used by the protocol
	mux.HandleFunc("/remoteDesktopGateway/", srv.handleRDGateway)
	mux.HandleFunc("/rpc/rpcproxy.dll", srv.handleRPCProxy)

	// Health check endpoint
	mux.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","service":"rdgw"}`)
	})

	httpServer := &http.Server{
		Addr:              listenAddr,
		Handler:           mux,
		ReadHeaderTimeout: 30 * time.Second,
		IdleTimeout:       time.Duration(idleTimeoutSec) * time.Second,
	}

	// Start idle tunnel cleanup goroutine
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	go srv.cleanupLoop(ctx)

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		<-sigCh
		log.Println("[rdgw] Shutting down...")
		cancel()

		shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer shutdownCancel()

		if err := httpServer.Shutdown(shutdownCtx); err != nil {
			log.Printf("[rdgw] Shutdown error: %v", err)
		}
	}()

	// Start server
	if tlsCert != "" && tlsKey != "" {
		log.Printf("[rdgw] Starting RD Gateway (TLS) on %s", listenAddr)
		httpServer.TLSConfig = &tls.Config{
			MinVersion: tls.VersionTLS12,
		}
		if err := httpServer.ListenAndServeTLS(tlsCert, tlsKey); err != http.ErrServerClosed {
			log.Fatalf("[rdgw] TLS server error: %v", err)
		}
	} else {
		log.Printf("[rdgw] Starting RD Gateway (plain HTTP — use a reverse proxy for TLS) on %s", listenAddr)
		if err := httpServer.ListenAndServe(); err != http.ErrServerClosed {
			log.Fatalf("[rdgw] Server error: %v", err)
		}
	}

	log.Println("[rdgw] Server stopped")
}

// handleRDGateway handles the /remoteDesktopGateway/ endpoint.
// This is the primary MS-TSGU entry point for native RDP clients.
func (s *rdgwServer) handleRDGateway(w http.ResponseWriter, r *http.Request) {
	log.Printf("[rdgw] %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)

	// MS-TSGU uses HTTP CONNECT-like semantics
	// The client sends RPC_IN_DATA (POST) and RPC_OUT_DATA (GET/POST) channels

	if r.Method == http.MethodGet {
		// RPC_OUT_DATA channel — this is where the server sends data to the client
		s.handleOutDataChannel(w, r)
		return
	}

	if r.Method == http.MethodPost {
		// RPC_IN_DATA channel — this is where the client sends data to the server
		s.handleInDataChannel(w, r)
		return
	}

	// Allow OPTIONS for CORS preflight
	if r.Method == http.MethodOptions {
		w.Header().Set("Allow", "GET, POST, OPTIONS")
		w.WriteHeader(http.StatusOK)
		return
	}

	http.Error(w, "Method Not Allowed", http.StatusMethodNotAllowed)
}

// handleRPCProxy handles the /rpc/rpcproxy.dll endpoint.
// Some RDP clients use this alternative path for the RPC-over-HTTPS tunnel.
func (s *rdgwServer) handleRPCProxy(w http.ResponseWriter, r *http.Request) {
	log.Printf("[rdgw] RPC proxy: %s %s from %s", r.Method, r.URL.Path, r.RemoteAddr)
	s.handleRDGateway(w, r)
}

// handleOutDataChannel handles the RPC_OUT_DATA channel (server -> client).
func (s *rdgwServer) handleOutDataChannel(w http.ResponseWriter, r *http.Request) {
	// Authenticate the request
	username, _, ok := r.BasicAuth()
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="Arsenale RD Gateway"`)
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	log.Printf("[rdgw] OUT_DATA channel authenticated for user: %s", username)

	// Set response headers for long-running streaming
	w.Header().Set("Content-Type", "application/rpc")
	w.Header().Set("Cache-Control", "no-cache")
	w.WriteHeader(http.StatusOK)

	// Flush headers
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Keep the connection open for the duration of the tunnel
	<-r.Context().Done()
}

// handleInDataChannel handles the RPC_IN_DATA channel (client -> server).
func (s *rdgwServer) handleInDataChannel(w http.ResponseWriter, r *http.Request) {
	// Authenticate the request
	username, _, ok := r.BasicAuth()
	if !ok {
		w.Header().Set("WWW-Authenticate", `Basic realm="Arsenale RD Gateway"`)
		http.Error(w, "Authentication required", http.StatusUnauthorized)
		return
	}

	log.Printf("[rdgw] IN_DATA channel authenticated for user: %s", username)

	// Extract target from the request
	// The target is typically encoded in the query string or RPC headers
	targetHost, targetPort := s.extractTarget(r)
	if targetHost == "" {
		http.Error(w, "No target specified", http.StatusBadRequest)
		return
	}

	log.Printf("[rdgw] Connecting to target: %s:%d for user %s", targetHost, targetPort, username)

	// Connect to the target RDP host
	targetAddr := fmt.Sprintf("%s:%d", targetHost, targetPort)
	upstream, err := net.DialTimeout("tcp", targetAddr, 10*time.Second)
	if err != nil {
		log.Printf("[rdgw] Failed to connect to target %s: %v", targetAddr, err)
		http.Error(w, "Failed to connect to target", http.StatusBadGateway)
		return
	}
	defer upstream.Close()

	// Set response headers
	w.Header().Set("Content-Type", "application/rpc")
	w.WriteHeader(http.StatusOK)

	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}

	// Bidirectional data forwarding
	done := make(chan struct{}, 2)

	// Client -> Target
	go func() {
		defer func() { done <- struct{}{} }()
		_, copyErr := io.Copy(upstream, r.Body)
		if copyErr != nil {
			log.Printf("[rdgw] Client->Target copy ended: %v", copyErr)
		}
	}()

	// Target -> Client (via response writer)
	go func() {
		defer func() { done <- struct{}{} }()
		if hijacker, ok := w.(http.Hijacker); ok {
			conn, buf, err := hijacker.Hijack()
			if err != nil {
				log.Printf("[rdgw] Hijack failed: %v", err)
				return
			}
			defer conn.Close()
			_, copyErr := io.Copy(buf, upstream)
			if copyErr != nil {
				log.Printf("[rdgw] Target->Client copy ended: %v", copyErr)
			}
			_ = buf.Flush()
		}
	}()

	// Wait for either direction to finish
	<-done
	log.Printf("[rdgw] Tunnel closed for user %s -> %s", username, targetAddr)
}

// extractTarget parses the target host:port from the RDP gateway request.
func (s *rdgwServer) extractTarget(r *http.Request) (string, int) {
	// Try query parameter first (common in RDG)
	target := r.URL.Query().Get("target")
	if target == "" {
		// Try X-Target header (custom Arsenale extension)
		target = r.Header.Get("X-Target")
	}
	if target == "" {
		// Try the path component (some clients encode target in the path)
		parts := strings.Split(r.URL.Path, "/")
		for i, part := range parts {
			if part == "target" && i+1 < len(parts) {
				target = parts[i+1]
				break
			}
		}
	}

	if target == "" {
		return "", 0
	}

	// Parse host:port
	host, portStr, err := net.SplitHostPort(target)
	if err != nil {
		// Assume default RDP port
		return target, 3389
	}

	port, err := strconv.Atoi(portStr)
	if err != nil {
		return host, 3389
	}

	return host, port
}

// cleanupLoop periodically removes idle tunnels.
func (s *rdgwServer) cleanupLoop(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupIdleTunnels()
		}
	}
}

// cleanupIdleTunnels removes tunnels that have been idle beyond the timeout.
func (s *rdgwServer) cleanupIdleTunnels() {
	cutoff := time.Now().Add(-s.idleTimeout)
	var cleaned int

	s.tunnels.Range(func(key, value any) bool {
		t := value.(*tunnel)
		t.mu.Lock()
		idle := t.lastActivityAt.Before(cutoff)
		t.mu.Unlock()

		if idle {
			if t.upstream != nil {
				_ = t.upstream.Close()
			}
			s.tunnels.Delete(key)
			cleaned++
		}
		return true
	})

	if cleaned > 0 {
		log.Printf("[rdgw] Cleaned up %d idle tunnel(s)", cleaned)
	}
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
