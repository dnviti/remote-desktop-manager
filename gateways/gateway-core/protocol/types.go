// Package protocol defines the binary frame encoding for the Arsenale tunnel
// wire protocol. The format mirrors the server-side TunnelBroker:
//
//	4-byte header:
//	  byte 0   : message type
//	  byte 1   : flags (reserved, set to 0)
//	  bytes 2-3: stream ID (uint16 big-endian)
//	followed by variable-length payload.
package protocol

// Message type constants matching the TunnelBroker wire format.
const (
	// MsgOpen initiates a new stream. Payload is "host:port".
	MsgOpen byte = 1
	// MsgData carries bidirectional payload on an existing stream.
	MsgData byte = 2
	// MsgClose terminates a stream.
	MsgClose byte = 3
	// MsgPing is a heartbeat request (may carry JSON health metadata).
	MsgPing byte = 4
	// MsgPong is a heartbeat acknowledgement.
	MsgPong byte = 5
	// MsgHeartbeat carries JSON metadata from the agent.
	MsgHeartbeat byte = 6
	// MsgCertRenew signals certificate rotation.
	MsgCertRenew byte = 7

	// Extended message types for session management.

	// MsgSessionCreate requests creation of a new remote session.
	MsgSessionCreate byte = 8
	// MsgSessionData carries data within a session context.
	MsgSessionData byte = 9
	// MsgSessionClose terminates a session.
	MsgSessionClose byte = 10
	// MsgSessionEvent reports a session audit event.
	MsgSessionEvent byte = 11
	// MsgCredentialPush delivers credentials to a session.
	MsgCredentialPush byte = 12
	// MsgPolicyPush delivers policy configuration to a session.
	MsgPolicyPush byte = 13
	// MsgSessionPause pauses a session.
	MsgSessionPause byte = 14
	// MsgSessionResume resumes a paused session.
	MsgSessionResume byte = 15
)

// HeaderSize is the fixed size of the binary frame header in bytes.
const HeaderSize = 4

// Frame represents a parsed binary tunnel protocol frame.
type Frame struct {
	// Type is the message type (one of the Msg* constants).
	Type byte
	// Flags is reserved for future use and should be 0.
	Flags byte
	// StreamID identifies the multiplexed stream (uint16).
	StreamID uint16
	// Payload is the variable-length frame body (may be empty).
	Payload []byte
}
