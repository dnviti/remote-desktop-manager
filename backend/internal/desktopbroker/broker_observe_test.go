package desktopbroker

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type observerDesktopStore struct {
	mu            sync.Mutex
	state         DesktopSessionState
	pollSessionID chan string
}

func (s *observerDesktopStore) FinalizeDesktopSession(context.Context, string, string) error {
	return nil
}

func (s *observerDesktopStore) GetDesktopSessionState(context.Context, string) (DesktopSessionState, error) {
	return DesktopSessionState{}, nil
}

func (s *observerDesktopStore) GetDesktopSessionStateBySessionID(_ context.Context, sessionID string) (DesktopSessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pollSessionID != nil {
		select {
		case s.pollSessionID <- sessionID:
		default:
		}
	}
	return s.state, nil
}

func (s *observerDesktopStore) RecordDesktopConnectionReady(context.Context, string, string) error {
	return nil
}

func TestBrokerObserverUsesGuacamoleJoinAndObservedSessionState(t *testing.T) {
	originalInterval := desktopSessionStatePollInterval
	desktopSessionStatePollInterval = 25 * time.Millisecond
	defer func() { desktopSessionStatePollInterval = originalInterval }()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen fake guacd: %v", err)
	}
	defer listener.Close()

	selectSeen := make(chan []string, 1)
	connectSeen := make(chan []string, 1)

	go func() {
		conn, acceptErr := listener.Accept()
		if acceptErr != nil {
			return
		}
		defer conn.Close()

		decoder := &Decoder{}
		var pending [][]string
		readInstruction := func() []string {
			if len(pending) > 0 {
				instruction := pending[0]
				pending = pending[1:]
				return instruction
			}
			buffer := make([]byte, 4096)
			for {
				n, readErr := conn.Read(buffer)
				if readErr != nil {
					return nil
				}
				instructions, feedErr := decoder.Feed(buffer[:n])
				if feedErr != nil {
					return nil
				}
				if len(instructions) > 0 {
					pending = append(pending, instructions[1:]...)
					return instructions[0]
				}
			}
		}

		if instruction := readInstruction(); instruction != nil {
			selectSeen <- instruction
		}
		_, _ = conn.Write([]byte(EncodeInstruction("args", "VERSION_1_1_0", "read-only")))

		for {
			instruction := readInstruction()
			if instruction == nil {
				return
			}
			if instruction[0] == "connect" {
				connectSeen <- instruction
				break
			}
		}

		_, _ = conn.Write([]byte(EncodeInstruction("ready", "observer-ready")))
		<-time.After(200 * time.Millisecond)
	}()

	store := &observerDesktopStore{pollSessionID: make(chan string, 1)}
	token := ConnectionToken{}
	token.Connection.Type = "rdp"
	token.Connection.Join = "owner-connection-123"
	token.Connection.GuacdHost = strings.Split(listener.Addr().String(), ":")[0]
	token.Connection.GuacdPort = listener.Addr().(*net.TCPAddr).Port
	token.Connection.Settings = map[string]any{"read-only": "true"}
	token.Metadata = map[string]any{MetadataKeyObserveSessionID: "sess-observe"}

	broker := NewBroker(BrokerConfig{
		GuacamoleSecret: "broker-secret",
		SessionStore:    store,
	})

	server := httptest.NewServer(http.HandlerFunc(broker.HandleWebSocket))
	defer server.Close()

	wsURL := "ws" + strings.TrimPrefix(server.URL, "http") + "/?token=" + mustEncryptToken(t, "broker-secret", token)
	wsConn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		t.Fatalf("dial broker websocket: %v", err)
	}
	defer wsConn.Close()

	_, payload, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready message: %v", err)
	}
	if string(payload) != EncodeInstruction("ready", "observer-ready") {
		t.Fatalf("unexpected ready payload: %q", string(payload))
	}

	select {
	case instruction := <-selectSeen:
		if len(instruction) != 2 || instruction[0] != "select" || instruction[1] != "owner-connection-123" {
			t.Fatalf("unexpected select instruction: %#v", instruction)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for select instruction")
	}

	select {
	case instruction := <-connectSeen:
		if len(instruction) != 3 || instruction[0] != "connect" || instruction[2] != "true" {
			t.Fatalf("unexpected connect instruction: %#v", instruction)
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for connect instruction")
	}

	select {
	case sessionID := <-store.pollSessionID:
		if sessionID != "sess-observe" {
			t.Fatalf("observer poll session id = %q, want %q", sessionID, "sess-observe")
		}
	case <-time.After(3 * time.Second):
		t.Fatal("timed out waiting for observed session state poll")
	}
}
