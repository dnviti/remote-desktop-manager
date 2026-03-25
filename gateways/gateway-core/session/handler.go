// Package session provides session lifecycle management for Arsenale gateway
// agents. It dispatches session-related frames to protocol-specific handlers
// (SSH, RDP, DB) and tracks active sessions.
package session

import "context"

// SessionHandler is the interface that gateway agents implement to handle
// sessions for a specific protocol (e.g., SSH, RDP, database proxy).
type SessionHandler interface {
	// Protocol returns the protocol identifier (e.g., "ssh", "rdp", "db").
	Protocol() string

	// Create initializes a new session with the given parameters.
	// The params map contains protocol-specific configuration.
	Create(ctx context.Context, sessionID string, params map[string]string) error

	// HandleData processes incoming session data.
	HandleData(sessionID string, data []byte) error

	// Close terminates the session and releases resources.
	Close(sessionID string) error

	// DeliverCredentials provides credentials to an active session.
	DeliverCredentials(sessionID string, creds map[string]string) error

	// ApplyPolicy delivers policy configuration to an active session.
	ApplyPolicy(sessionID string, policy map[string]string) error

	// Pause suspends session activity (e.g., stops data forwarding).
	Pause(sessionID string) error

	// Resume restores a paused session.
	Resume(sessionID string) error
}
