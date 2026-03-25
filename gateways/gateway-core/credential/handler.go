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

// SensitiveBytes is a []byte wrapper for secret fields. Unlike Go strings,
// the backing array can be reliably zeroed in place. It marshals/unmarshals
// as a JSON string and prints as [REDACTED] to prevent accidental logging.
type SensitiveBytes []byte

// String returns a redacted placeholder so secrets are never printed via fmt.
func (s SensitiveBytes) String() string { return "[REDACTED]" }

// MarshalJSON encodes SensitiveBytes as a JSON string.
func (s SensitiveBytes) MarshalJSON() ([]byte, error) {
	return json.Marshal(string(s))
}

// UnmarshalJSON decodes a JSON string into SensitiveBytes.
func (s *SensitiveBytes) UnmarshalJSON(data []byte) error {
	var str string
	if err := json.Unmarshal(data, &str); err != nil {
		return err
	}
	*s = SensitiveBytes(str)
	return nil
}

// Credentials holds the authentication material for a session.
type Credentials struct {
	Username   string            `json:"username,omitempty"`
	Password   SensitiveBytes    `json:"password,omitempty"`
	PrivateKey SensitiveBytes    `json:"privateKey,omitempty"`
	Passphrase SensitiveBytes    `json:"passphrase,omitempty"`
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

	// Return a deep copy to prevent external mutation and ensure
	// independent SensitiveBytes backing arrays.
	cp := Credentials{
		Username: creds.Username,
	}
	if creds.Password != nil {
		cp.Password = make(SensitiveBytes, len(creds.Password))
		copy(cp.Password, creds.Password)
	}
	if creds.PrivateKey != nil {
		cp.PrivateKey = make(SensitiveBytes, len(creds.PrivateKey))
		copy(cp.PrivateKey, creds.PrivateKey)
	}
	if creds.Passphrase != nil {
		cp.Passphrase = make(SensitiveBytes, len(creds.Passphrase))
		copy(cp.Passphrase, creds.Passphrase)
	}
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

// zeroCreds overwrites all sensitive fields with zeroes in place, then nils
// the slices. Because SensitiveBytes is a []byte, the backing array is
// zeroed directly — unlike Go strings whose backing memory is immutable.
func zeroCreds(c *Credentials) {
	for i := range c.Password {
		c.Password[i] = 0
	}
	c.Password = nil

	for i := range c.PrivateKey {
		c.PrivateKey[i] = 0
	}
	c.PrivateKey = nil

	for i := range c.Passphrase {
		c.Passphrase[i] = 0
	}
	c.Passphrase = nil

	c.Username = ""
	for k := range c.Extra {
		c.Extra[k] = ""
	}
}
