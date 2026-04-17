package terminalbroker

import (
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

func TestObserverSubscribersReceiveReadOnlyFanout(t *testing.T) {
	t.Parallel()

	ownerServer, ownerClient, cleanupOwner := openTerminalTestSocket(t)
	defer cleanupOwner()
	observerAServer, observerAClient, cleanupObserverA := openTerminalTestSocket(t)
	defer cleanupObserverA()
	observerBServer, observerBClient, cleanupObserverB := openTerminalTestSocket(t)
	defer cleanupObserverB()

	stdin := &captureWriteCloser{}
	fakeSession := &fakeRuntimeSession{}
	runtime := &terminalRuntime{
		logger:       slog.Default(),
		session:      fakeSession,
		stdin:        stdin,
		sessionStore: NoopSessionStore{},
		closed:       make(chan struct{}),
		observers:    make(map[*terminalSubscriber]struct{}),
	}

	owner := newTerminalSubscriber(runtime, ownerServer, contracts.TerminalSessionModeControl, true)
	observerA := newTerminalSubscriber(runtime, observerAServer, contracts.TerminalSessionModeObserve, false)
	observerB := newTerminalSubscriber(runtime, observerBServer, contracts.TerminalSessionModeObserve, false)
	for _, subscriber := range []*terminalSubscriber{owner, observerA, observerB} {
		if !runtime.attachSubscriber(subscriber) {
			t.Fatal("attachSubscriber() = false, want true")
		}
		if err := subscriber.send(serverMessage{Type: "ready"}); err != nil {
			t.Fatalf("send ready: %v", err)
		}
	}

	go owner.readWebSocket()
	go observerA.readWebSocket()
	go observerB.readWebSocket()

	assertServerMessage(t, ownerClient, serverMessage{Type: "ready"})
	assertServerMessage(t, observerAClient, serverMessage{Type: "ready"})
	assertServerMessage(t, observerBClient, serverMessage{Type: "ready"})

	if !runtime.broadcast(serverMessage{Type: "data", Data: "hello"}) {
		t.Fatal("broadcast(data) = false, want true")
	}
	assertServerMessage(t, ownerClient, serverMessage{Type: "data", Data: "hello"})
	assertServerMessage(t, observerAClient, serverMessage{Type: "data", Data: "hello"})
	assertServerMessage(t, observerBClient, serverMessage{Type: "data", Data: "hello"})

	writeClientMessage(t, observerAClient, clientMessage{Type: "input", Data: "whoami\n"})
	assertServerMessage(t, observerAClient, serverMessage{Type: "error", Code: "READ_ONLY", Message: "observer connection is read-only"})
	if got := stdin.String(); got != "" {
		t.Fatalf("observer input wrote to stdin = %q, want empty", got)
	}

	writeClientMessage(t, observerAClient, clientMessage{Type: "resize", Cols: 120, Rows: 40})
	assertServerMessage(t, observerAClient, serverMessage{Type: "error", Code: "READ_ONLY", Message: "observer connection is read-only"})
	if got := fakeSession.windowChanges(); len(got) != 0 {
		t.Fatalf("observer resize windowChanges = %+v, want none", got)
	}

	writeClientMessage(t, ownerClient, clientMessage{Type: "input", Data: "ls\n"})
	waitForCondition(t, func() bool { return stdin.String() == "ls\n" }, "owner input should reach runtime stdin")

	writeClientMessage(t, ownerClient, clientMessage{Type: "resize", Cols: 100, Rows: 30})
	waitForCondition(t, func() bool {
		changes := fakeSession.windowChanges()
		return len(changes) == 1 && changes[0].rows == 30 && changes[0].cols == 100
	}, "owner resize should update SSH window")

	writeClientMessage(t, observerAClient, clientMessage{Type: "close"})
	waitForCondition(t, func() bool {
		select {
		case <-observerA.closed:
			return true
		default:
			return false
		}
	}, "observer close should disconnect observer only")
	select {
	case <-runtime.closed:
		t.Fatal("observer close closed shared runtime")
	default:
	}

	if !runtime.broadcast(serverMessage{Type: "data", Data: "still-live"}) {
		t.Fatal("broadcast(still-live) = false, want true")
	}
	assertServerMessage(t, ownerClient, serverMessage{Type: "data", Data: "still-live"})
	assertServerMessage(t, observerBClient, serverMessage{Type: "data", Data: "still-live"})

	runtime.close()
	assertServerMessage(t, ownerClient, serverMessage{Type: "closed"})
	assertServerMessage(t, observerBClient, serverMessage{Type: "closed"})
}

type captureWriteCloser struct {
	mu   sync.Mutex
	data []byte
}

func (w *captureWriteCloser) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.data = append(w.data, p...)
	return len(p), nil
}

func (w *captureWriteCloser) Close() error {
	return nil
}

func (w *captureWriteCloser) String() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	return string(w.data)
}

type fakeWindowChange struct {
	rows int
	cols int
}

type fakeRuntimeSession struct {
	mu           sync.Mutex
	resizeEvents []fakeWindowChange
}

func (*fakeRuntimeSession) StdinPipe() (io.WriteCloser, error) {
	return nil, nil
}

func (*fakeRuntimeSession) StdoutPipe() (io.Reader, error) {
	return nil, nil
}

func (*fakeRuntimeSession) StderrPipe() (io.Reader, error) {
	return nil, nil
}

func (*fakeRuntimeSession) RequestPty(string, int, int, ssh.TerminalModes) error {
	return nil
}

func (*fakeRuntimeSession) Shell() error {
	return nil
}

func (s *fakeRuntimeSession) WindowChange(rows, cols int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.resizeEvents = append(s.resizeEvents, fakeWindowChange{rows: rows, cols: cols})
	return nil
}

func (*fakeRuntimeSession) Wait() error {
	return nil
}

func (*fakeRuntimeSession) Close() error {
	return nil
}

func (s *fakeRuntimeSession) windowChanges() []fakeWindowChange {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]fakeWindowChange, len(s.resizeEvents))
	copy(result, s.resizeEvents)
	return result
}

func writeClientMessage(t *testing.T, conn *websocket.Conn, message clientMessage) {
	t.Helper()
	payload, err := json.Marshal(message)
	if err != nil {
		t.Fatalf("marshal client message: %v", err)
	}
	if err := conn.WriteMessage(websocket.TextMessage, payload); err != nil {
		t.Fatalf("write client message: %v", err)
	}
}

func assertServerMessage(t *testing.T, conn *websocket.Conn, want serverMessage) {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(2 * time.Second))
	defer conn.SetReadDeadline(time.Time{})
	_, payload, err := conn.ReadMessage()
	if err != nil {
		t.Fatalf("read server message: %v", err)
	}
	var got serverMessage
	if err := json.Unmarshal(payload, &got); err != nil {
		t.Fatalf("unmarshal server message: %v", err)
	}
	if got != want {
		t.Fatalf("server message = %#v, want %#v", got, want)
	}
}

func waitForCondition(t *testing.T, condition func() bool, description string) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("timed out waiting: %s", description)
}
