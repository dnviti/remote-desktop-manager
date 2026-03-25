package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
)

var (
	// ErrFrameTooShort is returned when the buffer is smaller than HeaderSize.
	ErrFrameTooShort = errors.New("frame too short: need at least 4 bytes")
	// ErrInvalidMsgType is returned for unrecognized message types.
	ErrInvalidMsgType = errors.New("invalid message type")
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
// any remaining bytes after the frame, and an error if the buffer is malformed.
//
// Because frames are length-delimited by the WebSocket message boundary (each
// WS message contains exactly one frame), remaining is typically empty. It is
// provided for callers that buffer multiple frames.
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
	if len(payload) > 0 {
		f.Payload = make([]byte, len(payload))
		copy(f.Payload, payload)
	}

	return f, nil, nil
}
