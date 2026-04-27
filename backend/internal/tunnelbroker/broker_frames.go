package tunnelbroker

type tunnelFrame struct {
	Type     msgType
	StreamID uint16
	Payload  []byte
}

func parseFrame(raw []byte) (tunnelFrame, bool) {
	if len(raw) < frameHeaderSize {
		return tunnelFrame{}, false
	}
	if len(raw)-frameHeaderSize > maxFramePayloadSize {
		return tunnelFrame{}, false
	}
	return tunnelFrame{
		Type:     msgType(raw[0]),
		StreamID: uint16(raw[2])<<8 | uint16(raw[3]),
		Payload:  raw[frameHeaderSize:],
	}, true
}

func buildFrame(frameType msgType, streamID uint16, payload []byte) []byte {
	frame := make([]byte, frameHeaderSize+len(payload))
	frame[0] = byte(frameType)
	frame[1] = 0
	frame[2] = byte(streamID >> 8)
	frame[3] = byte(streamID)
	copy(frame[frameHeaderSize:], payload)
	return frame
}
