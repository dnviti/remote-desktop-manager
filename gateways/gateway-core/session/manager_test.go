package session

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// mockHandler is a test SessionHandler that records calls.
type mockHandler struct {
	protocol    string
	created     []string
	dataCalls   map[string][][]byte
	closed      []string
	credentials map[string]map[string]string
	policies    map[string]map[string]string
	paused      []string
	resumed     []string
}

func newMockHandler(proto string) *mockHandler {
	return &mockHandler{
		protocol:    proto,
		dataCalls:   make(map[string][][]byte),
		credentials: make(map[string]map[string]string),
		policies:    make(map[string]map[string]string),
	}
}

func (m *mockHandler) Protocol() string { return m.protocol }

func (m *mockHandler) Create(_ context.Context, sessionID string, _ map[string]string) error {
	m.created = append(m.created, sessionID)
	return nil
}

func (m *mockHandler) HandleData(sessionID string, data []byte) error {
	m.dataCalls[sessionID] = append(m.dataCalls[sessionID], data)
	return nil
}

func (m *mockHandler) Close(sessionID string) error {
	m.closed = append(m.closed, sessionID)
	return nil
}

func (m *mockHandler) DeliverCredentials(sessionID string, creds map[string]string) error {
	m.credentials[sessionID] = creds
	return nil
}

func (m *mockHandler) ApplyPolicy(sessionID string, policy map[string]string) error {
	m.policies[sessionID] = policy
	return nil
}

func (m *mockHandler) Pause(sessionID string) error {
	m.paused = append(m.paused, sessionID)
	return nil
}

func (m *mockHandler) Resume(sessionID string) error {
	m.resumed = append(m.resumed, sessionID)
	return nil
}

func makeFrame(msgType byte, streamID uint16, payload interface{}) *protocol.Frame {
	data, _ := json.Marshal(payload)
	return &protocol.Frame{
		Type:     msgType,
		StreamID: streamID,
		Payload:  data,
	}
}

func TestSessionLifecycle(t *testing.T) {
	sm := NewSessionManager()
	handler := newMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	ctx := context.Background()

	// Create session
	createFrame := makeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
		SessionID: "sess-1",
		Protocol:  "ssh",
		Params:    map[string]string{"host": "10.0.0.1", "port": "22"},
	})
	if err := sm.HandleSessionCreate(ctx, createFrame); err != nil {
		t.Fatalf("HandleSessionCreate: %v", err)
	}
	if len(handler.created) != 1 || handler.created[0] != "sess-1" {
		t.Errorf("expected handler.created=[sess-1], got %v", handler.created)
	}

	// Verify session is tracked
	sessions := sm.ActiveSessions()
	if len(sessions) != 1 {
		t.Fatalf("expected 1 active session, got %d", len(sessions))
	}
	if sessions[0].Protocol != "ssh" {
		t.Errorf("session protocol: got %q, want %q", sessions[0].Protocol, "ssh")
	}

	// Send data
	dataFrame := makeFrame(protocol.MsgSessionData, 1, sessionDataPayload{
		SessionID: "sess-1",
		Data:      []byte("ls -la"),
	})
	if err := sm.HandleSessionData(dataFrame); err != nil {
		t.Fatalf("HandleSessionData: %v", err)
	}
	if len(handler.dataCalls["sess-1"]) != 1 {
		t.Errorf("expected 1 data call, got %d", len(handler.dataCalls["sess-1"]))
	}

	// Close session
	closeFrame := makeFrame(protocol.MsgSessionClose, 1, sessionClosePayload{
		SessionID: "sess-1",
	})
	if err := sm.HandleSessionClose(closeFrame); err != nil {
		t.Fatalf("HandleSessionClose: %v", err)
	}
	if len(handler.closed) != 1 {
		t.Errorf("expected 1 close, got %d", len(handler.closed))
	}
	if len(sm.ActiveSessions()) != 0 {
		t.Error("session should be removed after close")
	}
}

func TestCredentialAndPolicyPush(t *testing.T) {
	sm := NewSessionManager()
	handler := newMockHandler("rdp")
	sm.RegisterHandler("rdp", handler)

	// Create session first
	ctx := context.Background()
	createFrame := makeFrame(protocol.MsgSessionCreate, 2, sessionCreatePayload{
		SessionID: "sess-2",
		Protocol:  "rdp",
		Params:    map[string]string{"host": "10.0.0.2"},
	})
	if err := sm.HandleSessionCreate(ctx, createFrame); err != nil {
		t.Fatalf("HandleSessionCreate: %v", err)
	}

	// Push credentials
	credFrame := makeFrame(protocol.MsgCredentialPush, 2, credentialPayload{
		SessionID:   "sess-2",
		Credentials: map[string]string{"username": "admin"},
	})
	if err := sm.HandleCredentialPush(credFrame); err != nil {
		t.Fatalf("HandleCredentialPush: %v", err)
	}
	if handler.credentials["sess-2"]["username"] != "admin" {
		t.Error("credentials not delivered to handler")
	}

	// Push policy
	policyFrame := makeFrame(protocol.MsgPolicyPush, 2, policyPayload{
		SessionID: "sess-2",
		Policy:    map[string]string{"maxIdleMinutes": "30"},
	})
	if err := sm.HandlePolicyPush(policyFrame); err != nil {
		t.Fatalf("HandlePolicyPush: %v", err)
	}
	if handler.policies["sess-2"]["maxIdleMinutes"] != "30" {
		t.Error("policy not delivered to handler")
	}
}

func TestPauseResume(t *testing.T) {
	sm := NewSessionManager()
	handler := newMockHandler("db")
	sm.RegisterHandler("db", handler)

	ctx := context.Background()
	createFrame := makeFrame(protocol.MsgSessionCreate, 3, sessionCreatePayload{
		SessionID: "sess-3",
		Protocol:  "db",
		Params:    map[string]string{},
	})
	if err := sm.HandleSessionCreate(ctx, createFrame); err != nil {
		t.Fatalf("HandleSessionCreate: %v", err)
	}

	// Pause
	pauseFrame := makeFrame(protocol.MsgSessionPause, 3, sessionIDPayload{SessionID: "sess-3"})
	if err := sm.HandleSessionPause(pauseFrame); err != nil {
		t.Fatalf("HandleSessionPause: %v", err)
	}
	sess := sm.GetSession("sess-3")
	if sess == nil || !sess.Paused {
		t.Error("session should be paused")
	}

	// Resume
	resumeFrame := makeFrame(protocol.MsgSessionResume, 3, sessionIDPayload{SessionID: "sess-3"})
	if err := sm.HandleSessionResume(resumeFrame); err != nil {
		t.Fatalf("HandleSessionResume: %v", err)
	}
	sess = sm.GetSession("sess-3")
	if sess == nil || sess.Paused {
		t.Error("session should be resumed")
	}
}

func TestNoHandlerRegistered(t *testing.T) {
	sm := NewSessionManager()
	ctx := context.Background()

	createFrame := makeFrame(protocol.MsgSessionCreate, 1, sessionCreatePayload{
		SessionID: "sess-x",
		Protocol:  "unknown",
	})
	err := sm.HandleSessionCreate(ctx, createFrame)
	if err == nil {
		t.Error("expected error for unregistered protocol")
	}
}

func TestSessionNotFound(t *testing.T) {
	sm := NewSessionManager()
	handler := newMockHandler("ssh")
	sm.RegisterHandler("ssh", handler)

	dataFrame := makeFrame(protocol.MsgSessionData, 1, sessionDataPayload{
		SessionID: "nonexistent",
		Data:      []byte("data"),
	})
	err := sm.HandleSessionData(dataFrame)
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}
