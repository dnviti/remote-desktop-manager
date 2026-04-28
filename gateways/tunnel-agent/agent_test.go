package main

import (
	"context"
	"encoding/json"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestAgentSendsAuthHeadersAndHeartbeatPing(t *testing.T) {
	localListener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen local service: %v", err)
	}
	defer localListener.Close()
	go func() {
		conn, acceptErr := localListener.Accept()
		if acceptErr == nil {
			_ = conn.Close()
		}
	}()

	upgrader := websocket.Upgrader{}
	headersChecked := make(chan struct{})
	pingSeen := make(chan healthStatus, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer token" {
			t.Errorf("unexpected Authorization header %q", r.Header.Get("Authorization"))
		}
		if r.Header.Get("X-Gateway-Id") != "gw-1" {
			t.Errorf("unexpected gateway header %q", r.Header.Get("X-Gateway-Id"))
		}
		close(headersChecked)

		conn, upgradeErr := upgrader.Upgrade(w, r, nil)
		if upgradeErr != nil {
			t.Errorf("upgrade websocket: %v", upgradeErr)
			return
		}
		defer conn.Close()

		_, raw, readErr := conn.ReadMessage()
		if readErr != nil {
			t.Errorf("read heartbeat: %v", readErr)
			return
		}
		frame, parseErr := parseFrame(raw)
		if parseErr != nil {
			t.Errorf("parse heartbeat frame: %v", parseErr)
			return
		}
		if frame.Type != msgPing || frame.StreamID != 0 {
			t.Errorf("unexpected heartbeat frame: %#v", frame)
			return
		}
		var health healthStatus
		if err := json.Unmarshal(frame.Payload, &health); err != nil {
			t.Errorf("decode heartbeat payload: %v", err)
			return
		}
		pingSeen <- health
	}))
	defer server.Close()

	_, port, err := net.SplitHostPort(localListener.Addr().String())
	if err != nil {
		t.Fatalf("split local listener address: %v", err)
	}
	cfg := testConfig()
	cfg.ServerURL = "ws" + strings.TrimPrefix(server.URL, "http")
	cfg.PingInterval = 10 * time.Millisecond
	cfg.LocalServicePort = mustAtoi(t, port)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	agent := newTunnelAgent(cfg, newAgentLogger(nil, nil))
	done := make(chan struct{})
	go func() {
		_ = agent.Run(ctx)
		close(done)
	}()

	select {
	case <-headersChecked:
	case <-time.After(2 * time.Second):
		t.Fatalf("server did not receive agent headers")
	}

	select {
	case health := <-pingSeen:
		if !health.Healthy {
			t.Fatalf("expected healthy heartbeat, got %#v", health)
		}
	case <-time.After(2 * time.Second):
		t.Fatalf("server did not receive heartbeat ping")
	}
	cancel()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatalf("agent did not stop")
	}
}

func TestAgentCertificateRenewalUpdatesConfig(t *testing.T) {
	cfg := testConfig()
	agent := newTunnelAgent(cfg, newAgentLogger(nil, nil))
	agent.handleCertRenew([]byte(`{"clientCert":"cert-pem","clientKey":"key-pem"}`))

	if cfg.ClientCert != "cert-pem" || cfg.ClientKey != "key-pem" {
		t.Fatalf("certificate renewal did not update config: %#v", cfg)
	}
}

func mustAtoi(t *testing.T, value string) int {
	t.Helper()
	port, err := parsePort(value)
	if err != nil {
		t.Fatalf("parse port %q: %v", value, err)
	}
	return port
}
