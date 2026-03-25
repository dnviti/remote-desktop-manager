package tunnel

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

// upgrader is shared by test WebSocket servers.
var upgrader = websocket.Upgrader{
	CheckOrigin: func(_ *http.Request) bool { return true },
}

func TestConnectAndClose(t *testing.T) {
	// Start a test WebSocket server that accepts and immediately closes.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			t.Logf("upgrade error: %v", err)
			return
		}
		// Echo back frames until close
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				break
			}
			_ = conn.WriteMessage(mt, data)
		}
		_ = conn.Close()
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	cfg := Config{
		ServerURL:        wsURL,
		Token:            "test-token",
		GatewayID:        "gw-test",
		AgentVersion:     "1.0.0",
		LocalHost:        "127.0.0.1",
		PingInterval:     100 * time.Millisecond,
		ReconnectInitial: 50 * time.Millisecond,
		ReconnectMax:     200 * time.Millisecond,
	}

	client := NewTunnelClient(cfg)
	ctx := context.Background()

	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}

	if err := client.Close(); err != nil {
		t.Logf("Close returned: %v", err)
	}
}

func TestSendFrame(t *testing.T) {
	received := make(chan *protocol.Frame, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		_, data, err := conn.ReadMessage()
		if err != nil {
			return
		}
		frame, _, err := protocol.ParseFrame(data)
		if err != nil {
			return
		}
		received <- frame
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	cfg := Config{
		ServerURL:        wsURL,
		Token:            "test-token",
		GatewayID:        "gw-test",
		AgentVersion:     "1.0.0",
		PingInterval:     1 * time.Hour, // disable for this test
		ReconnectInitial: 50 * time.Millisecond,
		ReconnectMax:     200 * time.Millisecond,
	}

	client := NewTunnelClient(cfg)
	ctx := context.Background()

	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect failed: %v", err)
	}
	defer client.Close()

	frame := &protocol.Frame{
		Type:     protocol.MsgSessionCreate,
		StreamID: 42,
		Payload:  []byte(`{"protocol":"ssh"}`),
	}
	if err := client.SendFrame(frame); err != nil {
		t.Fatalf("SendFrame failed: %v", err)
	}

	select {
	case got := <-received:
		if got.Type != protocol.MsgSessionCreate {
			t.Errorf("type: got %d, want %d", got.Type, protocol.MsgSessionCreate)
		}
		if got.StreamID != 42 {
			t.Errorf("streamID: got %d, want 42", got.StreamID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for frame")
	}
}

func TestFrameHandlerCallback(t *testing.T) {
	handlerCalled := make(chan *protocol.Frame, 1)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Send a SESSION_CREATE frame to the client
		frame := protocol.BuildFrame(protocol.MsgSessionCreate, 1, []byte(`{"protocol":"rdp"}`))
		_ = conn.WriteMessage(websocket.BinaryMessage, frame)

		// Keep alive briefly
		time.Sleep(500 * time.Millisecond)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	cfg := Config{
		ServerURL:        wsURL,
		Token:            "test-token",
		GatewayID:        "gw-test",
		AgentVersion:     "1.0.0",
		PingInterval:     1 * time.Hour,
		ReconnectInitial: 50 * time.Millisecond,
		ReconnectMax:     200 * time.Millisecond,
	}

	client := NewTunnelClient(cfg)
	client.SetFrameHandler(func(f *protocol.Frame) {
		handlerCalled <- f
	})

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	// Run in background
	go func() {
		_ = client.Run(ctx)
	}()

	select {
	case f := <-handlerCalled:
		if f.Type != protocol.MsgSessionCreate {
			t.Errorf("handler got type %d, want %d", f.Type, protocol.MsgSessionCreate)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timeout waiting for frame handler callback")
	}

	_ = client.Close()
}

func TestStreamDataDelivery(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Send DATA for stream 5
		frame := protocol.BuildFrame(protocol.MsgData, 5, []byte("hello from server"))
		_ = conn.WriteMessage(websocket.BinaryMessage, frame)

		// Keep alive
		time.Sleep(500 * time.Millisecond)
	}))
	defer srv.Close()

	wsURL := "ws" + strings.TrimPrefix(srv.URL, "http")
	cfg := Config{
		ServerURL:        wsURL,
		Token:            "test-token",
		GatewayID:        "gw-test",
		AgentVersion:     "1.0.0",
		PingInterval:     1 * time.Hour,
		ReconnectInitial: 50 * time.Millisecond,
		ReconnectMax:     200 * time.Millisecond,
	}

	client := NewTunnelClient(cfg)

	// Register stream before connecting
	stream := client.OpenStream(5)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()

	go func() {
		_ = client.Run(ctx)
	}()

	// Read from stream
	buf := make([]byte, 1024)
	n, err := stream.Read(buf)
	if err != nil {
		t.Fatalf("stream.Read error: %v", err)
	}
	got := string(buf[:n])
	if got != "hello from server" {
		t.Errorf("got %q, want %q", got, "hello from server")
	}

	_ = client.Close()
}
