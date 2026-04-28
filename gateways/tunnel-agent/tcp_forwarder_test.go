package main

import (
	"context"
	"net"
	"sync"
	"testing"
	"time"
)

type sentFrame struct {
	Type     byte
	StreamID uint16
	Payload  []byte
}

type fakeSender struct {
	mu     sync.Mutex
	ready  bool
	frames []sentFrame
}

func newFakeSender() *fakeSender {
	return &fakeSender{ready: true}
}

func (s *fakeSender) SendFrame(frameType byte, streamID uint16, payload []byte) error {
	copied := make([]byte, len(payload))
	copy(copied, payload)
	s.mu.Lock()
	defer s.mu.Unlock()
	s.frames = append(s.frames, sentFrame{Type: frameType, StreamID: streamID, Payload: copied})
	return nil
}

func (s *fakeSender) Ready() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ready
}

func (s *fakeSender) frameCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.frames)
}

func (s *fakeSender) frameAt(index int) sentFrame {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.frames[index]
}

func TestForwarderRejectsInvalidAndNonLocalTargets(t *testing.T) {
	sender := newFakeSender()
	forwarder := newTCPForwarder(sender, newAgentLogger(nil, nil), "127.0.0.1", 4822)
	dialed := false
	forwarder.dial = func(context.Context, string, string) (net.Conn, error) {
		dialed = true
		return nil, nil
	}

	forwarder.handleOpenFrame(1, []byte("evil.com:22"))
	forwarder.handleOpenFrame(2, []byte("invalid-target"))
	forwarder.handleOpenFrame(3, []byte("localhost:99999"))
	forwarder.handleOpenFrame(4, []byte("127.0.0.1:4823"))

	if dialed {
		t.Fatalf("non-local or invalid targets must not dial")
	}
	if sender.frameCount() != 4 {
		t.Fatalf("expected close frames for all rejected targets, got %d", sender.frameCount())
	}
	for i := 0; i < 4; i++ {
		if frame := sender.frameAt(i); frame.Type != msgClose {
			t.Fatalf("frame %d type = %d, want CLOSE", i, frame.Type)
		}
	}
}

func TestForwarderOpensLocalSocketAndAcknowledges(t *testing.T) {
	sender := newFakeSender()
	forwarder := newTCPForwarder(sender, newAgentLogger(nil, nil), "127.0.0.1", 4822)
	var serverConn net.Conn
	var dialAddress string
	forwarder.dial = func(_ context.Context, _ string, address string) (net.Conn, error) {
		client, server := net.Pipe()
		serverConn = server
		dialAddress = address
		return client, nil
	}
	defer func() {
		if serverConn != nil {
			_ = serverConn.Close()
		}
		forwarder.destroyAllSockets()
	}()

	forwarder.handleOpenFrame(10, []byte("127.0.0.1:4822"))
	eventually(t, func() bool { return sender.frameCount() == 1 })

	if dialAddress != "127.0.0.1:4822" {
		t.Fatalf("unexpected dial address %q", dialAddress)
	}
	frame := sender.frameAt(0)
	if frame.Type != msgOpen || frame.StreamID != 10 {
		t.Fatalf("unexpected ack frame: %#v", frame)
	}
	if forwarder.activeStreamCount() != 1 {
		t.Fatalf("expected one active stream")
	}
}

func TestForwarderWritesIncomingDataToLocalSocket(t *testing.T) {
	sender := newFakeSender()
	forwarder, serverConn := openTestStream(t, sender, 20)
	defer forwarder.destroyAllSockets()
	defer serverConn.Close()

	payload := []byte("hello local service")
	go forwarder.handleDataFrame(20, payload)

	buf := make([]byte, len(payload))
	if _, err := serverConn.Read(buf); err != nil {
		t.Fatalf("read local socket data: %v", err)
	}
	if string(buf) != string(payload) {
		t.Fatalf("unexpected local socket payload %q", buf)
	}
}

func TestForwarderSendsLocalSocketDataAsTunnelData(t *testing.T) {
	sender := newFakeSender()
	forwarder, serverConn := openTestStream(t, sender, 30)
	defer forwarder.destroyAllSockets()
	defer serverConn.Close()

	if _, err := serverConn.Write([]byte("from local")); err != nil {
		t.Fatalf("write local socket: %v", err)
	}
	eventually(t, func() bool { return sender.frameCount() >= 2 })

	frame := sender.frameAt(1)
	if frame.Type != msgData || frame.StreamID != 30 || string(frame.Payload) != "from local" {
		t.Fatalf("unexpected DATA frame: %#v", frame)
	}
}

func TestForwarderClosesStream(t *testing.T) {
	sender := newFakeSender()
	forwarder, serverConn := openTestStream(t, sender, 40)
	defer serverConn.Close()

	forwarder.handleCloseFrame(40)
	eventually(t, func() bool { return forwarder.activeStreamCount() == 0 })
}

func openTestStream(t *testing.T, sender *fakeSender, streamID uint16) (*tcpForwarder, net.Conn) {
	t.Helper()
	forwarder := newTCPForwarder(sender, newAgentLogger(nil, nil), "127.0.0.1", 4822)
	var serverConn net.Conn
	forwarder.dial = func(context.Context, string, string) (net.Conn, error) {
		client, server := net.Pipe()
		serverConn = server
		return client, nil
	}
	forwarder.handleOpenFrame(streamID, []byte("127.0.0.1:4822"))
	eventually(t, func() bool { return forwarder.activeStreamCount() == 1 && sender.frameCount() == 1 })
	return forwarder, serverConn
}

func eventually(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition was not met before timeout")
}
