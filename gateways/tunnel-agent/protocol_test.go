package main

import (
	"bytes"
	"errors"
	"testing"
)

func TestBuildFrameAndParseFrameRoundTrip(t *testing.T) {
	payload := []byte("hello")
	raw, err := buildFrame(msgData, 42, payload)
	if err != nil {
		t.Fatalf("buildFrame returned error: %v", err)
	}
	if raw[0] != msgData || raw[1] != 0 {
		t.Fatalf("unexpected header bytes: %v", raw[:2])
	}
	frame, err := parseFrame(raw)
	if err != nil {
		t.Fatalf("parseFrame returned error: %v", err)
	}
	if frame.Type != msgData || frame.StreamID != 42 {
		t.Fatalf("unexpected frame header: %#v", frame)
	}
	if !bytes.Equal(frame.Payload, payload) {
		t.Fatalf("unexpected payload %q", frame.Payload)
	}
}

func TestParseFrameRejectsShortFrames(t *testing.T) {
	_, err := parseFrame([]byte{msgData, 0, 1})
	if !errors.Is(err, errFrameTooShort) {
		t.Fatalf("expected errFrameTooShort, got %v", err)
	}
}

func TestFramePayloadLimit(t *testing.T) {
	payload := make([]byte, maxFramePayloadLen+1)
	if _, err := buildFrame(msgData, 1, payload); !errors.Is(err, errPayloadTooLarge) {
		t.Fatalf("expected errPayloadTooLarge from buildFrame, got %v", err)
	}

	raw := append([]byte{msgData, 0, 0, 1}, payload...)
	if _, err := parseFrame(raw); !errors.Is(err, errPayloadTooLarge) {
		t.Fatalf("expected errPayloadTooLarge from parseFrame, got %v", err)
	}
}

func TestMessageTypeValuesMatchBrokerProtocol(t *testing.T) {
	expected := map[string]byte{
		"OPEN":       1,
		"DATA":       2,
		"CLOSE":      3,
		"PING":       4,
		"PONG":       5,
		"HEARTBEAT":  6,
		"CERT_RENEW": 7,
	}
	actual := map[string]byte{
		"OPEN":       msgOpen,
		"DATA":       msgData,
		"CLOSE":      msgClose,
		"PING":       msgPing,
		"PONG":       msgPong,
		"HEARTBEAT":  msgHeartbeat,
		"CERT_RENEW": msgCertRenew,
	}
	for name, value := range expected {
		if actual[name] != value {
			t.Fatalf("%s = %d, want %d", name, actual[name], value)
		}
	}
}
