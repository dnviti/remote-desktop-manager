package session

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"sync"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// maxSessionIDLength is the maximum allowed length for a session ID.
const maxSessionIDLength = 128

// validSessionIDPattern matches alphanumeric characters, hyphens, and underscores.
var validSessionIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]+$`)

// validateSessionID checks that a session ID is non-empty, within length limits,
// and contains only safe characters (alphanumeric, hyphens, and underscores).
func validateSessionID(id string) error {
	if id == "" {
		return fmt.Errorf("session ID must not be empty")
	}
	if len(id) > maxSessionIDLength {
		return fmt.Errorf("session ID too long: %d chars (max %d)", len(id), maxSessionIDLength)
	}
	if !validSessionIDPattern.MatchString(id) {
		return fmt.Errorf("session ID contains invalid characters (allowed: alphanumeric characters, hyphens, and underscores)")
	}
	return nil
}

// Session tracks an active session within the manager.
type Session struct {
	ID        string
	Protocol  string
	StreamID  uint16
	CreatedAt time.Time
	Paused    bool
}

// SessionManager dispatches session-related protocol frames to registered
// protocol handlers and tracks active sessions.
type SessionManager struct {
	handlers map[string]SessionHandler
	sessions map[string]*Session
	mu       sync.RWMutex
}

// NewSessionManager creates a new session manager.
func NewSessionManager() *SessionManager {
	return &SessionManager{
		handlers: make(map[string]SessionHandler),
		sessions: make(map[string]*Session),
	}
}

// RegisterHandler registers a protocol handler. Only one handler per protocol
// is allowed; subsequent registrations overwrite the previous one.
func (sm *SessionManager) RegisterHandler(proto string, handler SessionHandler) {
	sm.mu.Lock()
	defer sm.mu.Unlock()
	sm.handlers[proto] = handler
}

// sessionCreatePayload is the expected JSON body of a SESSION_CREATE frame.
type sessionCreatePayload struct {
	SessionID string            `json:"sessionId"`
	Protocol  string            `json:"protocol"`
	Params    map[string]string `json:"params"`
}

// HandleSessionCreate processes a SESSION_CREATE frame by dispatching to the
// appropriate protocol handler.
func (sm *SessionManager) HandleSessionCreate(ctx context.Context, frame *protocol.Frame) error {
	var p sessionCreatePayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing session create payload: %w", err)
	}

	if err := validateSessionID(p.SessionID); err != nil {
		return fmt.Errorf("invalid session ID: %w", err)
	}

	sm.mu.RLock()
	handler, ok := sm.handlers[p.Protocol]
	sm.mu.RUnlock()
	if !ok {
		return fmt.Errorf("no handler registered for protocol %q", p.Protocol)
	}

	if err := handler.Create(ctx, p.SessionID, p.Params); err != nil {
		return fmt.Errorf("creating session %s: %w", p.SessionID, err)
	}

	sm.mu.Lock()
	sm.sessions[p.SessionID] = &Session{
		ID:        p.SessionID,
		Protocol:  p.Protocol,
		StreamID:  frame.StreamID,
		CreatedAt: time.Now(),
	}
	sm.mu.Unlock()

	log.Printf("[session] Created session %s (protocol=%s, stream=%d)", p.SessionID, p.Protocol, frame.StreamID)
	return nil
}

// sessionDataPayload is the expected JSON wrapper for SESSION_DATA frames.
type sessionDataPayload struct {
	SessionID string `json:"sessionId"`
	Data      []byte `json:"data"`
}

// HandleSessionData routes session data to the appropriate handler.
func (sm *SessionManager) HandleSessionData(frame *protocol.Frame) error {
	var p sessionDataPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing session data payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}
	return handler.HandleData(p.SessionID, p.Data)
}

// sessionClosePayload is the expected JSON body of a SESSION_CLOSE frame.
type sessionClosePayload struct {
	SessionID string `json:"sessionId"`
}

// HandleSessionClose terminates a session and removes it from tracking.
func (sm *SessionManager) HandleSessionClose(frame *protocol.Frame) error {
	var p sessionClosePayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing session close payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}

	if err := handler.Close(p.SessionID); err != nil {
		return fmt.Errorf("closing session %s: %w", p.SessionID, err)
	}

	sm.mu.Lock()
	delete(sm.sessions, p.SessionID)
	sm.mu.Unlock()

	log.Printf("[session] Closed session %s", p.SessionID)
	return nil
}

// credentialPayload is the expected JSON body of a CREDENTIAL_PUSH frame.
type credentialPayload struct {
	SessionID   string            `json:"sessionId"`
	Credentials map[string]string `json:"credentials"`
}

// HandleCredentialPush delivers credentials to the session's handler.
func (sm *SessionManager) HandleCredentialPush(frame *protocol.Frame) error {
	var p credentialPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing credential push payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}
	return handler.DeliverCredentials(p.SessionID, p.Credentials)
}

// policyPayload is the expected JSON body of a POLICY_PUSH frame.
type policyPayload struct {
	SessionID string            `json:"sessionId"`
	Policy    map[string]string `json:"policy"`
}

// HandlePolicyPush delivers policy configuration to the session's handler.
func (sm *SessionManager) HandlePolicyPush(frame *protocol.Frame) error {
	var p policyPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing policy push payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}
	return handler.ApplyPolicy(p.SessionID, p.Policy)
}

// sessionIDPayload is shared by pause/resume frames.
type sessionIDPayload struct {
	SessionID string `json:"sessionId"`
}

// HandleSessionPause pauses an active session.
func (sm *SessionManager) HandleSessionPause(frame *protocol.Frame) error {
	var p sessionIDPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing session pause payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}
	if err := handler.Pause(p.SessionID); err != nil {
		return err
	}

	sm.mu.Lock()
	if s, ok := sm.sessions[p.SessionID]; ok {
		s.Paused = true
	}
	sm.mu.Unlock()

	log.Printf("[session] Paused session %s", p.SessionID)
	return nil
}

// HandleSessionResume resumes a paused session.
func (sm *SessionManager) HandleSessionResume(frame *protocol.Frame) error {
	var p sessionIDPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing session resume payload: %w", err)
	}

	handler, err := sm.handlerForSession(p.SessionID)
	if err != nil {
		return err
	}
	if err := handler.Resume(p.SessionID); err != nil {
		return err
	}

	sm.mu.Lock()
	if s, ok := sm.sessions[p.SessionID]; ok {
		s.Paused = false
	}
	sm.mu.Unlock()

	log.Printf("[session] Resumed session %s", p.SessionID)
	return nil
}

// ActiveSessions returns a copy of all currently active sessions.
func (sm *SessionManager) ActiveSessions() []*Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	result := make([]*Session, 0, len(sm.sessions))
	for _, s := range sm.sessions {
		cp := *s
		result = append(result, &cp)
	}
	return result
}

// GetSession returns the session with the given ID, or nil if not found.
func (sm *SessionManager) GetSession(sessionID string) *Session {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	s, ok := sm.sessions[sessionID]
	if !ok {
		return nil
	}
	cp := *s
	return &cp
}

// handlerForSession looks up the handler for a session by its stored protocol.
func (sm *SessionManager) handlerForSession(sessionID string) (SessionHandler, error) {
	sm.mu.RLock()
	sess, ok := sm.sessions[sessionID]
	if !ok {
		sm.mu.RUnlock()
		return nil, fmt.Errorf("session %s not found", sessionID)
	}
	handler, hOk := sm.handlers[sess.Protocol]
	sm.mu.RUnlock()
	if !hOk {
		return nil, fmt.Errorf("no handler for protocol %q (session %s)", sess.Protocol, sessionID)
	}
	return handler, nil
}
