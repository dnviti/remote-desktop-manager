package session

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// safeMockHandler is a thread-safe mock SessionHandler for concurrency tests.
type safeMockHandler struct {
	proto       string
	mu          sync.Mutex
	created     []string
	dataCalls   map[string][][]byte
	closed      []string
	credentials map[string]map[string]string
	policies    map[string]map[string]string
	paused      map[string]bool
}

func newSafeMockHandler(proto string) *safeMockHandler {
	return &safeMockHandler{
		proto:       proto,
		dataCalls:   make(map[string][][]byte),
		credentials: make(map[string]map[string]string),
		policies:    make(map[string]map[string]string),
		paused:      make(map[string]bool),
	}
}

func (m *safeMockHandler) Protocol() string { return m.proto }

func (m *safeMockHandler) Create(_ context.Context, sessionID string, _ map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.created = append(m.created, sessionID)
	return nil
}

func (m *safeMockHandler) HandleData(sessionID string, data []byte) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	cp := make([]byte, len(data))
	copy(cp, data)
	m.dataCalls[sessionID] = append(m.dataCalls[sessionID], cp)
	return nil
}

func (m *safeMockHandler) Close(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.closed = append(m.closed, sessionID)
	return nil
}

func (m *safeMockHandler) DeliverCredentials(sessionID string, creds map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.credentials[sessionID] = creds
	return nil
}

func (m *safeMockHandler) ApplyPolicy(sessionID string, policy map[string]string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.policies[sessionID] = policy
	return nil
}

func (m *safeMockHandler) Pause(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.paused[sessionID] = true
	return nil
}

func (m *safeMockHandler) Resume(sessionID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.paused[sessionID] = false
	return nil
}

func (m *safeMockHandler) getCreatedCount() int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.created)
}

func (m *safeMockHandler) getDataCount(sessionID string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.dataCalls[sessionID])
}

// safeMakeFrame builds a protocol frame with JSON payload.
func safeMakeFrame(msgType byte, streamID uint16, payload interface{}) *protocol.Frame {
	data, _ := json.Marshal(payload)
	return &protocol.Frame{
		Type:     msgType,
		StreamID: streamID,
		Payload:  data,
	}
}

func TestConcurrentSessionCreation(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	const numSessions = 50
	ctx := context.Background()
	var wg sync.WaitGroup

	errs := make([]error, numSessions)
	for i := 0; i < numSessions; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sid := fmt.Sprintf("sess-%04d", idx)
			frame := safeMakeFrame(protocol.MsgSessionCreate, uint16(idx+1), sessionCreatePayload{
				SessionID: sid,
				Protocol:  "ssh",
				Params:    map[string]string{"host": "10.0.0.1"},
			})
			errs[idx] = sm.HandleSessionCreate(ctx, frame)
		}(i)
	}
	wg.Wait()

	// All creations should succeed.
	for i, err := range errs {
		if err != nil {
			t.Errorf("session %d creation failed: %v", i, err)
		}
	}

	// All sessions should be active.
	sessions := sm.ActiveSessions()
	if len(sessions) != numSessions {
		t.Errorf("expected %d active sessions, got %d", numSessions, len(sessions))
	}

	// Handler should have received all creates.
	if handler.getCreatedCount() != numSessions {
		t.Errorf("handler received %d creates, want %d", handler.getCreatedCount(), numSessions)
	}

	// Verify all IDs are unique.
	seen := make(map[string]bool)
	for _, s := range sessions {
		if seen[s.ID] {
			t.Errorf("duplicate session ID: %s", s.ID)
		}
		seen[s.ID] = true
	}
}

func TestSessionCleanupOnCrash(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx, cancel := context.WithCancel(context.Background())

	// Create sessions.
	const numSessions = 10
	for i := 0; i < numSessions; i++ {
		sid := fmt.Sprintf("crash-%d", i)
		frame := safeMakeFrame(protocol.MsgSessionCreate, uint16(i+1), sessionCreatePayload{
			SessionID: sid,
			Protocol:  "ssh",
		})
		if err := sm.HandleSessionCreate(ctx, frame); err != nil {
			t.Fatalf("create session %d: %v", i, err)
		}
	}

	if len(sm.ActiveSessions()) != numSessions {
		t.Fatalf("expected %d sessions before crash", numSessions)
	}

	// Simulate crash: cancel context.
	cancel()

	// Close all sessions (simulating crash cleanup).
	for _, s := range sm.ActiveSessions() {
		closeFrame := safeMakeFrame(protocol.MsgSessionClose, s.StreamID, sessionClosePayload{
			SessionID: s.ID,
		})
		if err := sm.HandleSessionClose(closeFrame); err != nil {
			t.Errorf("close session %s: %v", s.ID, err)
		}
	}

	if len(sm.ActiveSessions()) != 0 {
		t.Error("all sessions should be cleaned up after crash")
	}

	handler.mu.Lock()
	closeCount := len(handler.closed)
	handler.mu.Unlock()
	if closeCount != numSessions {
		t.Errorf("handler received %d closes, want %d", closeCount, numSessions)
	}
}

func TestCredentialPushRaceSafety(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx := context.Background()
	frame := safeMakeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
		SessionID: "cred-race",
		Protocol:  "ssh",
	})
	if err := sm.HandleSessionCreate(ctx, frame); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Push credentials from multiple goroutines.
	const goroutines = 20
	var wg sync.WaitGroup
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			credFrame := safeMakeFrame(protocol.MsgCredentialPush, 1, credentialPayload{
				SessionID:   "cred-race",
				Credentials: map[string]string{"username": fmt.Sprintf("user-%d", idx)},
			})
			_ = sm.HandleCredentialPush(credFrame)
		}(i)
	}
	wg.Wait()

	// Verify handler got credentials (last writer wins is fine).
	handler.mu.Lock()
	creds, ok := handler.credentials["cred-race"]
	handler.mu.Unlock()
	if !ok {
		t.Error("no credentials delivered to handler")
	}
	if creds["username"] == "" {
		t.Error("credentials username is empty")
	}
}

func TestSessionDataRoutingUnderLoad(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx := context.Background()
	const numSessions = 20
	const framesPerSession = 100

	// Create sessions.
	for i := 0; i < numSessions; i++ {
		sid := fmt.Sprintf("route-%04d", i)
		frame := safeMakeFrame(protocol.MsgSessionCreate, uint16(i+1), sessionCreatePayload{
			SessionID: sid,
			Protocol:  "ssh",
		})
		if err := sm.HandleSessionCreate(ctx, frame); err != nil {
			t.Fatalf("create session %d: %v", i, err)
		}
	}

	// Send data to all sessions concurrently.
	var wg sync.WaitGroup
	var errCount atomic.Int32
	for i := 0; i < numSessions; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sid := fmt.Sprintf("route-%04d", idx)
			for j := 0; j < framesPerSession; j++ {
				dataFrame := safeMakeFrame(protocol.MsgSessionData, uint16(idx+1), sessionDataPayload{
					SessionID: sid,
					Data:      []byte(fmt.Sprintf("data-%d-%d", idx, j)),
				})
				if err := sm.HandleSessionData(dataFrame); err != nil {
					errCount.Add(1)
				}
			}
		}(i)
	}
	wg.Wait()

	if errCount.Load() > 0 {
		t.Errorf("%d data routing errors", errCount.Load())
	}

	// Verify each session received the correct number of frames.
	for i := 0; i < numSessions; i++ {
		sid := fmt.Sprintf("route-%04d", i)
		count := handler.getDataCount(sid)
		if count != framesPerSession {
			t.Errorf("session %s: got %d frames, want %d", sid, count, framesPerSession)
		}
	}
}

func TestInvalidSessionIDRejection(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)
	ctx := context.Background()

	invalidIDs := []struct {
		name string
		id   string
	}{
		{"SQL injection", "sess'; DROP TABLE sessions;--"},
		{"path traversal", "../../../etc/passwd"},
		{"null bytes", "sess\x00evil"},
		{"emoji", "sess-\U0001F4A9-test"},
		{"spaces", "sess with spaces"},
		{"HTML injection", "<script>alert(1)</script>"},
		{"empty string", ""},
		{"very long string", strings.Repeat("a", 200)},
		{"dots", "sess.evil.path"},
		{"slashes", "sess/evil/path"},
		{"backslashes", "sess\\evil\\path"},
		{"semicolons", "sess;cmd"},
		{"pipe", "sess|cmd"},
		{"angle brackets", "sess<>cmd"},
		{"unicode control", "sess\u0000\u0001\u0002"},
	}

	for _, tt := range invalidIDs {
		t.Run(tt.name, func(t *testing.T) {
			frame := safeMakeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
				SessionID: tt.id,
				Protocol:  "ssh",
			})
			err := sm.HandleSessionCreate(ctx, frame)
			if err == nil {
				t.Errorf("expected rejection for session ID %q, got nil error", tt.id)
			}
		})
	}

	// Verify no sessions were created.
	if len(sm.ActiveSessions()) != 0 {
		t.Errorf("expected 0 active sessions after invalid IDs, got %d", len(sm.ActiveSessions()))
	}
}

func TestSessionPauseResumeConcurrency(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx := context.Background()
	frame := safeMakeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
		SessionID: "pause-resume",
		Protocol:  "ssh",
	})
	if err := sm.HandleSessionCreate(ctx, frame); err != nil {
		t.Fatalf("create: %v", err)
	}

	const goroutines = 20
	var wg sync.WaitGroup

	// Rapidly pause and resume from multiple goroutines.
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				if idx%2 == 0 {
					pauseFrame := safeMakeFrame(protocol.MsgSessionPause, 1, sessionIDPayload{SessionID: "pause-resume"})
					_ = sm.HandleSessionPause(pauseFrame)
				} else {
					resumeFrame := safeMakeFrame(protocol.MsgSessionResume, 1, sessionIDPayload{SessionID: "pause-resume"})
					_ = sm.HandleSessionResume(resumeFrame)
				}
			}
		}(i)
	}
	wg.Wait()

	// Session should still exist and be in a consistent state (either paused or not).
	sess := sm.GetSession("pause-resume")
	if sess == nil {
		t.Fatal("session should still exist after concurrent pause/resume")
	}
	// Paused is a bool, so it must be true or false -- no partial state.
	t.Logf("Final paused state: %v (both are valid)", sess.Paused)
}

func TestOrphanSessionDetection(t *testing.T) {
	sm := NewSessionManager()
	handler := newSafeMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx := context.Background()
	frame := safeMakeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
		SessionID: "orphan",
		Protocol:  "ssh",
	})
	if err := sm.HandleSessionCreate(ctx, frame); err != nil {
		t.Fatalf("create: %v", err)
	}

	// Simulate orphan: session exists but no data is ever sent.
	// Verify the session can be queried and cleaned up manually.
	time.Sleep(100 * time.Millisecond)

	sess := sm.GetSession("orphan")
	if sess == nil {
		t.Fatal("orphan session should still be tracked")
	}
	if sess.CreatedAt.IsZero() {
		t.Error("CreatedAt should be set")
	}

	// Verify we can detect sessions that haven't received data.
	handler.mu.Lock()
	dataCount := len(handler.dataCalls["orphan"])
	handler.mu.Unlock()
	if dataCount != 0 {
		t.Errorf("orphan session received %d data calls, expected 0", dataCount)
	}

	// Clean up the orphan.
	closeFrame := safeMakeFrame(protocol.MsgSessionClose, 1, sessionClosePayload{
		SessionID: "orphan",
	})
	if err := sm.HandleSessionClose(closeFrame); err != nil {
		t.Fatalf("close orphan: %v", err)
	}

	if sm.GetSession("orphan") != nil {
		t.Error("orphan session should be removed after close")
	}
}
