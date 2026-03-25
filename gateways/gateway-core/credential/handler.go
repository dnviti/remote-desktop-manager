// Package credential provides secure in-memory credential storage for
// Arsenale gateway sessions. Credentials are stored per-session and securely
// zeroed on cleanup.
package credential

import (
	"encoding/json"
	"fmt"
	"sync"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// Credentials holds the authentication material for a session.
type Credentials struct {
	Username   string            `json:"username,omitempty"`
	Password   string            `json:"password,omitempty"`
	PrivateKey string            `json:"privateKey,omitempty"`
	Passphrase string            `json:"passphrase,omitempty"`
	Extra      map[string]string `json:"extra,omitempty"`
}

// credentialPushPayload is the expected JSON body of a CREDENTIAL_PUSH frame.
type credentialPushPayload struct {
	SessionID   string      `json:"sessionId"`
	Credentials Credentials `json:"credentials"`
}

// CredentialHandler manages per-session credential storage with secure
// cleanup.
type CredentialHandler struct {
	store map[string]*Credentials
	mu    sync.RWMutex
}

// NewCredentialHandler creates a new credential handler.
func NewCredentialHandler() *CredentialHandler {
	return &CredentialHandler{
		store: make(map[string]*Credentials),
	}
}

// HandlePush processes a CREDENTIAL_PUSH frame and stores the credentials
// in memory.
func (ch *CredentialHandler) HandlePush(frame *protocol.Frame) error {
	var p credentialPushPayload
	if err := json.Unmarshal(frame.Payload, &p); err != nil {
		return fmt.Errorf("parsing credential push: %w", err)
	}

	creds := p.Credentials
	ch.mu.Lock()
	// Clear any existing credentials for this session first.
	if old, ok := ch.store[p.SessionID]; ok {
		zeroCreds(old)
	}
	ch.store[p.SessionID] = &creds
	ch.mu.Unlock()

	return nil
}

// GetCredentials returns a copy of the credentials for the given session.
func (ch *CredentialHandler) GetCredentials(sessionID string) (*Credentials, error) {
	ch.mu.RLock()
	defer ch.mu.RUnlock()

	creds, ok := ch.store[sessionID]
	if !ok {
		return nil, fmt.Errorf("no credentials for session %s", sessionID)
	}

	// Return a copy to prevent external mutation.
	cp := *creds
	if creds.Extra != nil {
		cp.Extra = make(map[string]string, len(creds.Extra))
		for k, v := range creds.Extra {
			cp.Extra[k] = v
		}
	}
	return &cp, nil
}

// ClearCredentials securely zeroes and removes credentials for a session.
func (ch *CredentialHandler) ClearCredentials(sessionID string) {
	ch.mu.Lock()
	defer ch.mu.Unlock()

	if creds, ok := ch.store[sessionID]; ok {
		zeroCreds(creds)
		delete(ch.store, sessionID)
	}
}

// ClearAll securely zeroes and removes all stored credentials.
func (ch *CredentialHandler) ClearAll() {
	ch.mu.Lock()
	defer ch.mu.Unlock()

	for id, creds := range ch.store {
		zeroCreds(creds)
		delete(ch.store, id)
	}
}

// zeroCreds overwrites all sensitive string fields with zeroes to prevent
// them from lingering in memory.
func zeroCreds(c *Credentials) {
	zeroString(&c.Username)
	zeroString(&c.Password)
	zeroString(&c.PrivateKey)
	zeroString(&c.Passphrase)
	for k := range c.Extra {
		v := c.Extra[k]
		zeroString(&v)
		c.Extra[k] = v
	}
}

// zeroString overwrites a string's backing memory with zeroes.
// Note: Go strings are immutable, so we convert to a byte slice, zero it,
// then replace the string. This zeroes the byte slice copy, not the original
// string's backing array (which may still exist until GC). For defense-in-depth
// this is the best we can do in safe Go without unsafe pointers.
func zeroString(s *string) {
	b := []byte(*s)
	for i := range b {
		b[i] = 0
	}
	*s = string(b)
}
