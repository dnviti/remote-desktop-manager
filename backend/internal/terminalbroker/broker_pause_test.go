package terminalbroker

import (
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
)

func TestShouldForwardTerminalClientMessageWhenPaused(t *testing.T) {
	t.Parallel()

	if shouldForwardTerminalClientMessage("input", true) {
		t.Fatal("expected paused terminal input to be dropped")
	}
	if shouldForwardTerminalClientMessage("resize", true) {
		t.Fatal("expected paused terminal resize to be dropped")
	}
	if !shouldForwardTerminalClientMessage("ping", true) {
		t.Fatal("expected paused ping to pass through")
	}
	if !shouldForwardTerminalClientMessage("close", true) {
		t.Fatal("expected paused close to pass through")
	}
}

func TestStreamOutputWaitsUntilResume(t *testing.T) {
	t.Parallel()

	serverConn, clientConn, cleanup := openTerminalTestSocket(t)
	defer cleanup()

	runtime := &terminalRuntime{
		logger:    slog.Default(),
		closed:    make(chan struct{}),
		observers: make(map[*terminalSubscriber]struct{}),
	}
	if !runtime.attachSubscriber(newTerminalSubscriber(runtime, serverConn, contracts.TerminalSessionModeControl, true)) {
		t.Fatal("attachSubscriber() = false, want true")
	}
	runtime.setPaused(true)
	runtime.outputWG.Add(1)

	reader, writer := io.Pipe()
	writeDone := make(chan error, 1)
	type readResult struct {
		payload []byte
		err     error
	}
	readCh := make(chan readResult, 1)
	go runtime.streamOutput(reader)
	go func() {
		_, payload, err := clientConn.ReadMessage()
		readCh <- readResult{payload: payload, err: err}
	}()
	go func() {
		_, err := writer.Write([]byte("hello"))
		if closeErr := writer.Close(); err == nil {
			err = closeErr
		}
		writeDone <- err
	}()

	select {
	case result := <-readCh:
		t.Fatalf("unexpected paused terminal payload: err=%v payload=%s", result.err, string(result.payload))
	case <-time.After(150 * time.Millisecond):
	}

	runtime.setPaused(false)
	var result readResult
	select {
	case result = <-readCh:
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for resumed terminal payload")
	}
	if result.err != nil {
		t.Fatalf("read resumed terminal payload: %v", result.err)
	}

	var message serverMessage
	if err := json.Unmarshal(result.payload, &message); err != nil {
		t.Fatalf("unmarshal terminal payload: %v", err)
	}
	if message.Type != "data" || message.Data != "hello" {
		t.Fatalf("unexpected terminal payload: %#v", message)
	}

	select {
	case err := <-writeDone:
		if err != nil {
			t.Fatalf("write pipe output: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("timed out waiting for pipe writer to finish")
	}
	runtime.outputWG.Wait()
}

func openTerminalTestSocket(t *testing.T) (*websocket.Conn, *websocket.Conn, func()) {
	t.Helper()

	serverConnCh := make(chan *websocket.Conn, 1)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := websocket.Upgrade(w, r, nil, 1024, 1024)
		if err != nil {
			t.Errorf("upgrade websocket: %v", err)
			return
		}
		serverConnCh <- conn
	}))

	url := "ws" + strings.TrimPrefix(server.URL, "http")
	clientConn, _, err := websocket.DefaultDialer.Dial(url, nil)
	if err != nil {
		server.Close()
		t.Fatalf("dial websocket: %v", err)
	}

	var serverConn *websocket.Conn
	select {
	case serverConn = <-serverConnCh:
	case <-time.After(2 * time.Second):
		clientConn.Close()
		server.Close()
		t.Fatal("timed out waiting for server websocket")
	}

	cleanup := func() {
		_ = serverConn.Close()
		_ = clientConn.Close()
		server.Close()
	}
	return serverConn, clientConn, cleanup
}
