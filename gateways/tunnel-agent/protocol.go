package main

import (
	"encoding/binary"
	"errors"
	"fmt"
)

const (
	msgOpen      byte = 1
	msgData      byte = 2
	msgClose     byte = 3
	msgPing      byte = 4
	msgPong      byte = 5
	msgHeartbeat byte = 6
	msgCertRenew byte = 7

	frameHeaderSize    = 4
	maxFramePayloadLen = 10 * 1024 * 1024
)

var (
	errFrameTooShort   = errors.New("frame too short")
	errPayloadTooLarge = errors.New("frame payload exceeds maximum size")
)

type tunnelFrame struct {
	Type     byte
	StreamID uint16
	Payload  []byte
}

func buildFrame(frameType byte, streamID uint16, payload []byte) ([]byte, error) {
	if len(payload) > maxFramePayloadLen {
		return nil, fmt.Errorf("%w: %d bytes", errPayloadTooLarge, len(payload))
	}

	frame := make([]byte, frameHeaderSize+len(payload))
	frame[0] = frameType
	frame[1] = 0
	binary.BigEndian.PutUint16(frame[2:4], streamID)
	copy(frame[frameHeaderSize:], payload)
	return frame, nil
}

func parseFrame(raw []byte) (tunnelFrame, error) {
	if len(raw) < frameHeaderSize {
		return tunnelFrame{}, errFrameTooShort
	}
	if len(raw)-frameHeaderSize > maxFramePayloadLen {
		return tunnelFrame{}, errPayloadTooLarge
	}

	payload := raw[frameHeaderSize:]
	copiedPayload := make([]byte, len(payload))
	copy(copiedPayload, payload)

	return tunnelFrame{
		Type:     raw[0],
		StreamID: binary.BigEndian.Uint16(raw[2:4]),
		Payload:  copiedPayload,
	}, nil
}
