package tunnelbroker

import "testing"

func TestParseFrameRejectsOversizedPayload(t *testing.T) {
	raw := make([]byte, frameHeaderSize+maxFramePayloadSize+1)
	raw[0] = byte(msgData)
	raw[2] = 0
	raw[3] = 1

	if _, ok := parseFrame(raw); ok {
		t.Fatal("parseFrame accepted oversized payload")
	}
}

func TestParseFrameDecodesHeader(t *testing.T) {
	raw := buildFrame(msgData, 0x0102, []byte("hello"))
	frame, ok := parseFrame(raw)
	if !ok {
		t.Fatal("parseFrame rejected valid frame")
	}
	if frame.Type != msgData {
		t.Fatalf("type = %d, want %d", frame.Type, msgData)
	}
	if frame.StreamID != 0x0102 {
		t.Fatalf("streamID = %d, want %d", frame.StreamID, 0x0102)
	}
	if string(frame.Payload) != "hello" {
		t.Fatalf("payload = %q, want hello", frame.Payload)
	}
}
