package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
)

// MaxPayloadSize is the maximum allowed payload size (10 MB). Frames exceeding
// this limit are rejected to prevent excessive memory allocation.
const MaxPayloadSize = 10 * 1024 * 1024

var (
	// ErrFrameTooShort is returned when the buffer is smaller than HeaderSize.
	ErrFrameTooShort = errors.New("frame too short: need at least 4 bytes")
	// ErrInvalidMsgType is returned for unrecognized message types.
	ErrInvalidMsgType = errors.New("invalid message type")
	// ErrPayloadTooLarge is returned when the payload exceeds MaxPayloadSize.
	ErrPayloadTooLarge = errors.New("payload exceeds maximum size")
)

// BuildFrame constructs a binary frame from the given message type, stream ID,
// and optional payload. The returned byte slice is ready for transmission.
func BuildFrame(msgType byte, streamID uint16, payload []byte) []byte {
	frame := make([]byte, HeaderSize+len(payload))
	frame[0] = msgType
	frame[1] = 0 // flags — reserved
	binary.BigEndian.PutUint16(frame[2:4], streamID)
	if len(payload) > 0 {
		copy(frame[HeaderSize:], payload)
	}
	return frame
}

// ParseFrame decodes a binary frame from buf. It returns the parsed Frame,
// remaining bytes, and an error if the buffer is malformed.
//
// The wire format relies on WebSocket message boundaries (one WS message = one
// frame). The remaining return value is kept for forward compatibility but will
// be nil on successful parses.
func ParseFrame(buf []byte) (*Frame, []byte, error) {
	if len(buf) < HeaderSize {
		return nil, buf, ErrFrameTooShort
	}

	msgType := buf[0]
	if msgType < MsgOpen || msgType > MsgSessionResume {
		return nil, buf, fmt.Errorf("%w: %d", ErrInvalidMsgType, msgType)
	}

	f := &Frame{
		Type:     msgType,
		Flags:    buf[1],
		StreamID: binary.BigEndian.Uint16(buf[2:4]),
	}

	payload := buf[HeaderSize:]
	if len(payload) > MaxPayloadSize {
		return nil, buf, fmt.Errorf("%w: %d bytes (max %d)", ErrPayloadTooLarge, len(payload), MaxPayloadSize)
	}
	if len(payload) > 0 {
		f.Payload = make([]byte, len(payload))
		copy(f.Payload, payload)
	}

	return f, nil, nil
}
