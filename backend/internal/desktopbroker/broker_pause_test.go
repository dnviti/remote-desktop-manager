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

type statefulDesktopStore struct {
	mu       sync.Mutex
	state    DesktopSessionState
	polled   chan struct{}
	finalize int
}

func (s *statefulDesktopStore) FinalizeDesktopSession(context.Context, string, string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.finalize++
	return nil
}

func (s *statefulDesktopStore) GetDesktopSessionState(context.Context, string) (DesktopSessionState, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.polled != nil {
		select {
		case <-s.polled:
		default:
			close(s.polled)
		}
	}
	return s.state, nil
}

func (s *statefulDesktopStore) GetDesktopSessionStateBySessionID(context.Context, string) (DesktopSessionState, error) {
	return s.GetDesktopSessionState(context.Background(), "")
}

func (s *statefulDesktopStore) RecordDesktopConnectionReady(context.Context, string, string) error {
	return nil
}

func (s *statefulDesktopStore) setState(state DesktopSessionState) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = state
	s.polled = make(chan struct{})
}

func (s *statefulDesktopStore) waitForPoll(t *testing.T) {
	t.Helper()

	s.mu.Lock()
	polled := s.polled
	s.mu.Unlock()
	if polled == nil {
		return
	}

	select {
	case <-polled:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for desktop session state poll")
	}
	time.Sleep(20 * time.Millisecond)
}

func TestBrokerPausesAndResumesTransportFromPersistedState(t *testing.T) {
	originalInterval := desktopSessionStatePollInterval
	desktopSessionStatePollInterval = 25 * time.Millisecond
	defer func() { desktopSessionStatePollInterval = originalInterval }()

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen fake guacd: %v", err)
	}
	defer listener.Close()

	received := make(chan []string, 8)
	sendToClient := make(chan string, 8)

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

		if instruction := readInstruction(); instruction == nil || instruction[0] != "select" {
			return
		}
		_, _ = conn.Write([]byte(EncodeInstruction("args", "VERSION_1_1_0", "hostname", "port", "username", "password")))
		for {
			instruction := readInstruction()
			if instruction == nil {
				return
			}
			if instruction[0] == "connect" {
				break
			}
		}
		_, _ = conn.Write([]byte(EncodeInstruction("ready", "desktop-ready")))

		go func() {
			for message := range sendToClient {
				_, _ = conn.Write([]byte(message))
			}
		}()

		for {
			instruction := readInstruction()
			if instruction == nil {
				return
			}
			received <- instruction
		}
	}()
	defer close(sendToClient)

	store := &statefulDesktopStore{state: DesktopSessionState{Exists: true}}
	token := sampleConnectionToken()
	token.Connection.GuacdHost = strings.Split(listener.Addr().String(), ":")[0]
	token.Connection.GuacdPort = listener.Addr().(*net.TCPAddr).Port

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
	type readResult struct {
		payload []byte
		err     error
	}

	_, payload, err := wsConn.ReadMessage()
	if err != nil {
		t.Fatalf("read ready message: %v", err)
	}
	if string(payload) != EncodeInstruction("ready", "desktop-ready") {
		t.Fatalf("unexpected ready payload: %q", string(payload))
	}

	store.setState(DesktopSessionState{Exists: true, Paused: true})
	store.waitForPoll(t)
	pausedReadCh := make(chan readResult, 1)
	go func() {
		_, payload, err := wsConn.ReadMessage()
		pausedReadCh <- readResult{payload: payload, err: err}
	}()

	if err := wsConn.WriteMessage(websocket.TextMessage, []byte(EncodeInstruction("sync", "0"))); err != nil {
		t.Fatalf("write paused websocket message: %v", err)
	}
	select {
	case instruction := <-received:
		t.Fatalf("unexpected guacd instruction while paused: %#v", instruction)
	case <-time.After(150 * time.Millisecond):
	}

	sendToClient <- EncodeInstruction("sync", "1")
	select {
	case result := <-pausedReadCh:
		t.Fatalf("unexpected paused websocket payload: err=%v payload=%s", result.err, string(result.payload))
	case <-time.After(150 * time.Millisecond):
	}

	store.setState(DesktopSessionState{Exists: true})
	store.waitForPoll(t)

	var resumed readResult
	select {
	case resumed = <-pausedReadCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resumed desktop payload")
	}
	if resumed.err != nil {
		t.Fatalf("read resumed payload: %v", resumed.err)
	}
	if string(resumed.payload) != EncodeInstruction("sync", "1") {
		t.Fatalf("unexpected resumed payload: %q", string(resumed.payload))
	}

	if err := wsConn.WriteMessage(websocket.TextMessage, []byte(EncodeInstruction("sync", "2"))); err != nil {
		t.Fatalf("write resumed websocket message: %v", err)
	}
	select {
	case instruction := <-received:
		if len(instruction) != 2 || instruction[0] != "sync" || instruction[1] != "2" {
			t.Fatalf("unexpected forwarded instruction after resume: %#v", instruction)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resumed client instruction")
	}
}
