package protocol

import (
	"bytes"
	"errors"
	"testing"
)

func TestBuildParseRoundTrip(t *testing.T) {
	tests := []struct {
		name     string
		msgType  byte
		streamID uint16
		payload  []byte
	}{
		{"OPEN empty payload", MsgOpen, 1, nil},
		{"DATA with payload", MsgData, 42, []byte("hello world")},
		{"CLOSE empty", MsgClose, 0xFFFF, nil},
		{"PING with JSON", MsgPing, 0, []byte(`{"healthy":true}`)},
		{"PONG empty", MsgPong, 0, nil},
		{"HEARTBEAT with metadata", MsgHeartbeat, 0, []byte(`{"uptime":3600}`)},
		{"CERT_RENEW", MsgCertRenew, 0, []byte("new-cert-data")},
		{"SESSION_CREATE", MsgSessionCreate, 100, []byte(`{"protocol":"ssh","host":"10.0.0.1"}`)},
		{"SESSION_DATA", MsgSessionData, 100, []byte{0x00, 0xFF, 0x80}},
		{"SESSION_CLOSE", MsgSessionClose, 100, nil},
		{"SESSION_EVENT", MsgSessionEvent, 100, []byte(`{"event":"query_executed"}`)},
		{"CREDENTIAL_PUSH", MsgCredentialPush, 100, []byte(`{"username":"admin"}`)},
		{"POLICY_PUSH", MsgPolicyPush, 100, []byte(`{"maxIdleMinutes":30}`)},
		{"SESSION_PAUSE", MsgSessionPause, 100, nil},
		{"SESSION_RESUME", MsgSessionResume, 100, nil},
		{"max stream ID", MsgData, 0xFFFF, []byte("max-id")},
		{"zero stream ID", MsgData, 0, []byte("zero-id")},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			frame := BuildFrame(tt.msgType, tt.streamID, tt.payload)

			parsed, remaining, err := ParseFrame(frame)
			if err != nil {
				t.Fatalf("ParseFrame returned error: %v", err)
			}
			if remaining != nil {
				t.Fatalf("expected nil remaining, got %d bytes", len(remaining))
			}

			if parsed.Type != tt.msgType {
				t.Errorf("type: got %d, want %d", parsed.Type, tt.msgType)
			}
			if parsed.Flags != 0 {
				t.Errorf("flags: got %d, want 0", parsed.Flags)
			}
			if parsed.StreamID != tt.streamID {
				t.Errorf("streamID: got %d, want %d", parsed.StreamID, tt.streamID)
			}
			if !bytes.Equal(parsed.Payload, tt.payload) {
				t.Errorf("payload: got %v, want %v", parsed.Payload, tt.payload)
			}
		})
	}
}

func TestParseFrameTooShort(t *testing.T) {
	for _, size := range []int{0, 1, 2, 3} {
		buf := make([]byte, size)
		_, _, err := ParseFrame(buf)
		if err != ErrFrameTooShort {
			t.Errorf("size=%d: got err=%v, want ErrFrameTooShort", size, err)
		}
	}
}

func TestParseFrameInvalidType(t *testing.T) {
	// Type 0 (below MsgOpen)
	buf := BuildFrame(MsgOpen, 0, nil)
	buf[0] = 0
	_, _, err := ParseFrame(buf)
	if err == nil {
		t.Fatal("expected error for type 0")
	}

	// Type 16 (above MsgSessionResume)
	buf[0] = 16
	_, _, err = ParseFrame(buf)
	if err == nil {
		t.Fatal("expected error for type 16")
	}
}

func TestBuildFrameHeaderLayout(t *testing.T) {
	// Verify exact byte layout: [type, flags=0, streamID-hi, streamID-lo, payload...]
	frame := BuildFrame(MsgData, 0x0102, []byte{0xAB})

	if frame[0] != MsgData {
		t.Errorf("byte 0: got %d, want %d", frame[0], MsgData)
	}
	if frame[1] != 0 {
		t.Errorf("byte 1 (flags): got %d, want 0", frame[1])
	}
	if frame[2] != 0x01 || frame[3] != 0x02 {
		t.Errorf("bytes 2-3 (streamID): got %02x%02x, want 0102", frame[2], frame[3])
	}
	if frame[4] != 0xAB {
		t.Errorf("byte 4 (payload): got %02x, want AB", frame[4])
	}
}

func TestParseFramePayloadTooLarge(t *testing.T) {
	// Build a frame header manually with an oversized payload.
	header := BuildFrame(MsgData, 1, nil)
	oversized := make([]byte, MaxPayloadSize+1)
	buf := append(header, oversized...)
	_, _, err := ParseFrame(buf)
	if err == nil {
		t.Fatal("expected error for oversized payload")
	}
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Errorf("expected ErrPayloadTooLarge, got: %v", err)
	}
}

func TestParseFramePayloadAtMaxSize(t *testing.T) {
	payload := make([]byte, MaxPayloadSize)
	buf := BuildFrame(MsgData, 1, payload)
	frame, _, err := ParseFrame(buf)
	if err != nil {
		t.Fatalf("expected no error at max payload size, got: %v", err)
	}
	if len(frame.Payload) != MaxPayloadSize {
		t.Errorf("payload length: got %d, want %d", len(frame.Payload), MaxPayloadSize)
	}
}

func TestPayloadIsolation(t *testing.T) {
	// Verify that modifying the original payload doesn't affect the built frame,
	// and modifying the parsed payload doesn't affect the original.
	original := []byte("secret")
	frame := BuildFrame(MsgData, 1, original)
	original[0] = 'X' // mutate source

	parsed, _, err := ParseFrame(frame)
	if err != nil {
		t.Fatalf("ParseFrame error: %v", err)
	}
	if parsed.Payload[0] == 'X' {
		t.Error("BuildFrame did not copy payload — mutation leaked through")
	}

	// Mutate parsed payload — should not affect the frame buffer
	parsed.Payload[0] = 'Z'
	reparsed, _, err := ParseFrame(frame)
	if err != nil {
		t.Fatalf("ParseFrame error on re-parse: %v", err)
	}
	if reparsed.Payload[0] == 'Z' {
		t.Error("ParseFrame did not copy payload — mutation leaked through")
	}
}
