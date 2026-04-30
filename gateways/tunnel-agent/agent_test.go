package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

func TestAgentConnectsAndForwardsTCP(t *testing.T) {
	echoAddr, stopEcho := startEchoServer(t)
	defer stopEcho()

	upgrader := websocket.Upgrader{}
	connected := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if got := r.Header.Get("Authorization"); got != "Bearer tok" {
			t.Errorf("Authorization = %q", got)
		}
		if got := r.Header.Get("X-Gateway-Id"); got != "gw" {
			t.Errorf("X-Gateway-Id = %q", got)
		}
		cert, err := url.QueryUnescape(r.Header.Get("X-Client-Cert"))
		if err != nil || cert != "client cert" {
			t.Errorf("X-Client-Cert decoded=%q err=%v", cert, err)
		}
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		connected <- conn
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	agent := NewAgent(Config{
		ServerURL:        wsURL(server.URL),
		Token:            "tok",
		GatewayID:        "gw",
		ClientCert:       "client cert",
		AgentVersion:     "test",
		PingInterval:     20 * time.Millisecond,
		ReconnectInitial: 10 * time.Millisecond,
		ReconnectMax:     20 * time.Millisecond,
		LocalServiceHost: "127.0.0.1",
		LocalServicePort: mustPort(t, echoAddr),
	})
	done := make(chan error, 1)
	go func() { done <- agent.Run(ctx) }()

	conn := waitConn(t, connected)
	defer conn.Close()

	streamID := uint16(7)
	sendWSFrame(t, conn, protocol.MsgOpen, streamID, []byte("127.0.0.1:"+portString(t, echoAddr)))
	frame := readWSFrame(t, conn)
	if frame.Type != protocol.MsgOpen || frame.StreamID != streamID {
		t.Fatalf("open ack = %#v", frame)
	}

	sendWSFrame(t, conn, protocol.MsgData, streamID, []byte("hello"))
	frame = readUntilFrame(t, conn, protocol.MsgData)
	if frame.StreamID != streamID || string(frame.Payload) != "hello" {
		t.Fatalf("data frame = %#v", frame)
	}

	sendWSFrame(t, conn, protocol.MsgPing, 3, nil)
	frame = readUntilFrame(t, conn, protocol.MsgPong)
	if frame.StreamID != 3 {
		t.Fatalf("pong frame = %#v", frame)
	}

	cancel()
	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("agent did not stop")
	}
}

func TestAgentSendsHealthPing(t *testing.T) {
	echoAddr, stopEcho := startEchoServer(t)
	defer stopEcho()

	upgrader := websocket.Upgrader{}
	connected := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		connected <- conn
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	agent := NewAgent(Config{
		ServerURL:        wsURL(server.URL),
		Token:            "tok",
		GatewayID:        "gw",
		AgentVersion:     "test",
		PingInterval:     10 * time.Millisecond,
		ReconnectInitial: 10 * time.Millisecond,
		ReconnectMax:     20 * time.Millisecond,
		LocalServiceHost: "127.0.0.1",
		LocalServicePort: mustPort(t, echoAddr),
	})
	go func() { _ = agent.Run(ctx) }()

	conn := waitConn(t, connected)
	defer conn.Close()
	frame := readUntilFrame(t, conn, protocol.MsgPing)
	if frame.StreamID != 0 {
		t.Fatalf("ping stream id = %d, want 0", frame.StreamID)
	}
	var health healthStatus
	if err := json.Unmarshal(frame.Payload, &health); err != nil {
		t.Fatalf("unmarshal health: %v", err)
	}
	if !health.Healthy {
		t.Fatalf("health = %#v, want healthy", health)
	}
}

func TestAgentReconnectsWithRenewedCertificate(t *testing.T) {
	upgrader := websocket.Upgrader{}
	headers := make(chan string, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		decoded, _ := url.QueryUnescape(r.Header.Get("X-Client-Cert"))
		headers <- decoded
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Errorf("upgrade: %v", err)
			return
		}
		if decoded == "old cert" {
			payload, _ := json.Marshal(map[string]string{"clientCert": "new cert", "clientKey": "new key"})
			_ = conn.WriteMessage(websocket.BinaryMessage, protocol.BuildFrame(protocol.MsgCertRenew, 0, payload))
		}
	}))
	defer server.Close()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	agent := NewAgent(Config{
		ServerURL:        wsURL(server.URL),
		Token:            "tok",
		GatewayID:        "gw",
		ClientCert:       "old cert",
		ClientKey:        "old key",
		AgentVersion:     "test",
		PingInterval:     100 * time.Millisecond,
		ReconnectInitial: 10 * time.Millisecond,
		ReconnectMax:     20 * time.Millisecond,
		LocalServiceHost: "127.0.0.1",
		LocalServicePort: 1,
	})
	go func() { _ = agent.Run(ctx) }()

	if got := waitHeader(t, headers); got != "old cert" {
		t.Fatalf("first cert = %q", got)
	}
	if got := waitHeader(t, headers); got != "new cert" {
		t.Fatalf("second cert = %q", got)
	}
}

func startEchoServer(t *testing.T) (string, func()) {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 1024)
				for {
					n, err := c.Read(buf)
					if n > 0 {
						_, _ = c.Write(buf[:n])
					}
					if err != nil {
						return
					}
				}
			}(conn)
		}
	}()
	return listener.Addr().String(), func() {
		_ = listener.Close()
		<-done
	}
}

func wsURL(httpURL string) string {
	return "ws" + httpURL[len("http"):]
}

func waitConn(t *testing.T, ch <-chan *websocket.Conn) *websocket.Conn {
	t.Helper()
	select {
	case conn := <-ch:
		return conn
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for websocket connection")
		return nil
	}
}

func waitHeader(t *testing.T, ch <-chan string) string {
	t.Helper()
	select {
	case value := <-ch:
		return value
	case <-time.After(time.Second):
		t.Fatal("timeout waiting for header")
		return ""
	}
}

func sendWSFrame(t *testing.T, conn *websocket.Conn, frameType byte, streamID uint16, payload []byte) {
	t.Helper()
	if err := conn.WriteMessage(websocket.BinaryMessage, protocol.BuildFrame(frameType, streamID, payload)); err != nil {
		t.Fatalf("write ws frame: %v", err)
	}
}

func readWSFrame(t *testing.T, conn *websocket.Conn) *protocol.Frame {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(time.Second))
	messageType, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read ws frame: %v", err)
	}
	if messageType != websocket.BinaryMessage {
		t.Fatalf("message type = %d", messageType)
	}
	frame, _, err := protocol.ParseFrameAny(payload)
	if err != nil {
		t.Fatalf("parse frame: %v", err)
	}
	return frame
}

func readUntilFrame(t *testing.T, conn *websocket.Conn, frameType byte) *protocol.Frame {
	t.Helper()
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		frame := readWSFrame(t, conn)
		if frame.Type == frameType {
			return frame
		}
	}
	t.Fatalf("timeout waiting for frame type %d", frameType)
	return nil
}

func mustPort(t *testing.T, addr string) int {
	t.Helper()
	_, raw, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	var port int
	if _, err := fmt.Sscanf(raw, "%d", &port); err != nil {
		t.Fatalf("parse port: %v", err)
	}
	return port
}

func portString(t *testing.T, addr string) string {
	t.Helper()
	_, raw, err := net.SplitHostPort(addr)
	if err != nil {
		t.Fatalf("split host port: %v", err)
	}
	return raw
}
