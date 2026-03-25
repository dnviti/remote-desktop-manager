package adapters

import (
	"context"
	"encoding/binary"
	"testing"
)

func TestDB2Adapter_Protocol(t *testing.T) {
	a := NewDB2Adapter()
	if got := a.Protocol(); got != "db2" {
		t.Errorf("Protocol() = %q, want %q", got, "db2")
	}
}

func TestDB2Adapter_DefaultPort(t *testing.T) {
	a := NewDB2Adapter()
	if got := a.DefaultPort(); got != 50000 {
		t.Errorf("DefaultPort() = %d, want %d", got, 50000)
	}
}

func TestDB2Adapter_HealthCheck(t *testing.T) {
	a := NewDB2Adapter()
	if err := a.HealthCheck(); err != nil {
		t.Errorf("HealthCheck() = %v, want nil", err)
	}
}

func TestDB2Adapter_ActiveSessions_Empty(t *testing.T) {
	a := NewDB2Adapter()
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d, want 0", got)
	}
}

func TestDB2Adapter_Disconnect_NonExistent(t *testing.T) {
	a := NewDB2Adapter()
	a.Disconnect("non-existent")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() after Disconnect = %d, want 0", got)
	}
}

func TestDB2Adapter_Forward_NonExistentSession(t *testing.T) {
	a := NewDB2Adapter()
	err := a.Forward(nil, "non-existent", nil)
	if err == nil {
		t.Fatal("Forward() with non-existent session should return error")
	}
}

func TestDRDAConstants(t *testing.T) {
	tests := []struct {
		name     string
		got      int
		expected int
	}{
		{"ddmCodePointEXCSAT", ddmCodePointEXCSAT, 0x1041},
		{"ddmCodePointACCSEC", ddmCodePointACCSEC, 0x106D},
		{"ddmCodePointSECCHK", ddmCodePointSECCHK, 0x106E},
		{"ddmCodePointACCRDB", ddmCodePointACCRDB, 0x2001},
		{"ddmCodePointEXCSATRD", ddmCodePointEXCSATRD, 0x1443},
		{"ddmCodePointACCSECRD", ddmCodePointACCSECRD, 0x14AC},
		{"ddmCodePointSECCHKRM", ddmCodePointSECCHKRM, 0x1219},
		{"drdaDSSHeaderSize", drdaDSSHeaderSize, 6},
		{"drdaDDMHeaderSize", drdaDDMHeaderSize, 4},
		{"db2DefaultPort", db2DefaultPort, 50000},
		{"drdaSecMechUSRIDPWD", drdaSecMechUSRIDPWD, 0x03},
		{"drdaSecMechUSRIDONL", drdaSecMechUSRIDONL, 0x04},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("%s = 0x%04x, want 0x%04x", tt.name, tt.got, tt.expected)
			}
		})
	}
}

// --- DRDA packet construction tests ---

func TestMakeDRDAPacket_Structure(t *testing.T) {
	tests := []struct {
		name      string
		codePoint uint16
		payload   []byte
	}{
		{
			name:      "empty payload",
			codePoint: ddmCodePointEXCSAT,
			payload:   []byte{},
		},
		{
			name:      "with payload",
			codePoint: ddmCodePointACCSEC,
			payload:   []byte{0x01, 0x02, 0x03, 0x04, 0x05},
		},
		{
			name:      "SECCHK code point",
			codePoint: ddmCodePointSECCHK,
			payload:   []byte{0xAA, 0xBB},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pkt := makeDRDAPacket(tt.codePoint, tt.payload)

			ddmLen := drdaDDMHeaderSize + len(tt.payload)
			expectedDSSLen := drdaDSSHeaderSize + ddmLen

			if len(pkt) != expectedDSSLen {
				t.Fatalf("packet length = %d, want %d", len(pkt), expectedDSSLen)
			}

			// DSS header: bytes 0-1 = DSS length (big-endian)
			dssLen := binary.BigEndian.Uint16(pkt[0:2])
			if dssLen != uint16(expectedDSSLen) {
				t.Errorf("DSS length = %d, want %d", dssLen, expectedDSSLen)
			}

			// DSS magic byte
			if pkt[2] != 0xD0 {
				t.Errorf("DSS magic = 0x%02x, want 0xD0", pkt[2])
			}

			// DSS type (request)
			if pkt[3] != 0x01 {
				t.Errorf("DSS type = 0x%02x, want 0x01", pkt[3])
			}

			// Correlation ID (bytes 4-5)
			corrID := binary.BigEndian.Uint16(pkt[4:6])
			if corrID != 1 {
				t.Errorf("correlation ID = %d, want 1", corrID)
			}

			// DDM header: bytes 6-7 = DDM length
			gotDDMLen := binary.BigEndian.Uint16(pkt[6:8])
			if gotDDMLen != uint16(ddmLen) {
				t.Errorf("DDM length = %d, want %d", gotDDMLen, ddmLen)
			}

			// DDM code point: bytes 8-9
			gotCP := binary.BigEndian.Uint16(pkt[8:10])
			if gotCP != tt.codePoint {
				t.Errorf("DDM code point = 0x%04x, want 0x%04x", gotCP, tt.codePoint)
			}

			// Payload starts at byte 10
			for i, b := range tt.payload {
				if pkt[drdaDSSHeaderSize+drdaDDMHeaderSize+i] != b {
					t.Errorf("payload[%d] = 0x%02x, want 0x%02x", i, pkt[drdaDSSHeaderSize+drdaDDMHeaderSize+i], b)
				}
			}
		})
	}
}

// --- EXCSAT packet test via pipe ---

func TestSendDRDAExcsat_PacketFormat(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendDRDAExcsat(client)
	}()

	// Read DSS header (6 bytes)
	dssHeader := make([]byte, drdaDSSHeaderSize)
	if _, err := server.Read(dssHeader); err != nil {
		t.Fatalf("read DSS header: %v", err)
	}

	dssLen := binary.BigEndian.Uint16(dssHeader[0:2])
	if dssLen < uint16(drdaDSSHeaderSize+drdaDDMHeaderSize) {
		t.Fatalf("DSS length too short: %d", dssLen)
	}

	// DSS magic
	if dssHeader[2] != 0xD0 {
		t.Errorf("DSS magic = 0x%02x, want 0xD0", dssHeader[2])
	}

	// Read remaining bytes
	remaining := make([]byte, dssLen-uint16(drdaDSSHeaderSize))
	if _, err := server.Read(remaining); err != nil {
		t.Fatalf("read remaining: %v", err)
	}

	// DDM code point should be EXCSAT
	codePoint := binary.BigEndian.Uint16(remaining[2:4])
	if codePoint != ddmCodePointEXCSAT {
		t.Errorf("DDM code point = 0x%04x, want 0x%04x (EXCSAT)", codePoint, ddmCodePointEXCSAT)
	}

	// SRVNAM code point in payload (should be at offset 4+2 = 6 from remaining start)
	if len(remaining) > drdaDDMHeaderSize+4 {
		srvnamCP := binary.BigEndian.Uint16(remaining[drdaDDMHeaderSize+2 : drdaDDMHeaderSize+4])
		if srvnamCP != 0x116D {
			t.Errorf("SRVNAM code point = 0x%04x, want 0x116D", srvnamCP)
		}
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendDRDAExcsat returned error: %v", err)
	}
}

// --- ACCSEC packet test ---

func TestSendDRDAAccsec_PacketFormat(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendDRDAAccsec(client, drdaSecMechUSRIDPWD)
	}()

	// Read the full packet
	buf := make([]byte, 256)
	n, err := server.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pkt := buf[:n]

	// DSS length
	dssLen := binary.BigEndian.Uint16(pkt[0:2])
	if int(dssLen) != n {
		t.Errorf("DSS length = %d, actual read = %d", dssLen, n)
	}

	// DDM code point should be ACCSEC
	codePoint := binary.BigEndian.Uint16(pkt[drdaDSSHeaderSize+2 : drdaDSSHeaderSize+4])
	if codePoint != ddmCodePointACCSEC {
		t.Errorf("DDM code point = 0x%04x, want 0x%04x (ACCSEC)", codePoint, ddmCodePointACCSEC)
	}

	// Find SECMEC value in payload
	payloadStart := drdaDSSHeaderSize + drdaDDMHeaderSize
	if len(pkt) >= payloadStart+6 {
		secmecCP := binary.BigEndian.Uint16(pkt[payloadStart+2 : payloadStart+4])
		if secmecCP != 0x11A2 {
			t.Errorf("SECMEC code point = 0x%04x, want 0x11A2", secmecCP)
		}
		secmecVal := binary.BigEndian.Uint16(pkt[payloadStart+4 : payloadStart+6])
		if secmecVal != drdaSecMechUSRIDPWD {
			t.Errorf("SECMEC value = 0x%04x, want 0x%04x", secmecVal, drdaSecMechUSRIDPWD)
		}
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendDRDAAccsec returned error: %v", err)
	}
}

// --- SECCHK packet test ---

func TestSendDRDASecchk_ContainsCredentials(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendDRDASecchk(client, "db2admin", "s3cret")
	}()

	buf := make([]byte, 512)
	n, err := server.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pkt := buf[:n]

	// DDM code point should be SECCHK
	codePoint := binary.BigEndian.Uint16(pkt[drdaDSSHeaderSize+2 : drdaDSSHeaderSize+4])
	if codePoint != ddmCodePointSECCHK {
		t.Errorf("DDM code point = 0x%04x, want 0x%04x (SECCHK)", codePoint, ddmCodePointSECCHK)
	}

	// Verify USRID code point (0x11A0) exists in the payload
	found := findCodePointInPayload(pkt[drdaDSSHeaderSize+drdaDDMHeaderSize:], 0x11A0)
	if !found {
		t.Error("USRID code point (0x11A0) not found in SECCHK payload")
	}

	// Verify PASSWORD code point (0x11A1) exists in the payload
	found = findCodePointInPayload(pkt[drdaDSSHeaderSize+drdaDDMHeaderSize:], 0x11A1)
	if !found {
		t.Error("PASSWORD code point (0x11A1) not found in SECCHK payload")
	}

	// Verify SECMEC code point (0x11A2) exists in the payload
	found = findCodePointInPayload(pkt[drdaDSSHeaderSize+drdaDDMHeaderSize:], 0x11A2)
	if !found {
		t.Error("SECMEC code point (0x11A2) not found in SECCHK payload")
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendDRDASecchk returned error: %v", err)
	}
}

// --- ACCRDB packet test ---

func TestSendDRDAAccrdb_PacketFormat(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendDRDAAccrdb(client, "SAMPLE")
	}()

	buf := make([]byte, 256)
	n, err := server.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pkt := buf[:n]

	// DDM code point should be ACCRDB
	codePoint := binary.BigEndian.Uint16(pkt[drdaDSSHeaderSize+2 : drdaDSSHeaderSize+4])
	if codePoint != ddmCodePointACCRDB {
		t.Errorf("DDM code point = 0x%04x, want 0x%04x (ACCRDB)", codePoint, ddmCodePointACCRDB)
	}

	// Verify RDBNAM code point (0x2110) in payload
	found := findCodePointInPayload(pkt[drdaDSSHeaderSize+drdaDDMHeaderSize:], 0x2110)
	if !found {
		t.Error("RDBNAM code point (0x2110) not found in ACCRDB payload")
	}

	// Verify database name is in the packet
	dbNameFound := false
	for i := 0; i < len(pkt)-5; i++ {
		if string(pkt[i:i+6]) == "SAMPLE" {
			dbNameFound = true
			break
		}
	}
	if !dbNameFound {
		t.Error("database name 'SAMPLE' not found in ACCRDB packet")
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendDRDAAccrdb returned error: %v", err)
	}
}

// --- Session management tests ---

func TestDB2Adapter_SessionLifecycle(t *testing.T) {
	a := NewDB2Adapter()

	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())
	_, cancel3 := context.WithCancel(context.Background())

	a.mu.Lock()
	a.sessions["sess-1"] = &db2Session{id: "sess-1", cancel: cancel1}
	a.sessions["sess-2"] = &db2Session{id: "sess-2", cancel: cancel2}
	a.sessions["sess-3"] = &db2Session{id: "sess-3", cancel: cancel3}
	a.mu.Unlock()

	if got := a.ActiveSessions(); got != 3 {
		t.Errorf("ActiveSessions() = %d, want 3", got)
	}

	a.removeSession("sess-2")
	if got := a.ActiveSessions(); got != 2 {
		t.Errorf("after remove: ActiveSessions() = %d, want 2", got)
	}

	a.Disconnect("sess-1")
	if got := a.ActiveSessions(); got != 1 {
		t.Errorf("after Disconnect: ActiveSessions() = %d, want 1", got)
	}

	a.Disconnect("sess-3")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("after all removed: ActiveSessions() = %d, want 0", got)
	}
}

func TestDB2Adapter_RemoveSession_Idempotent(t *testing.T) {
	a := NewDB2Adapter()
	a.removeSession("does-not-exist")
	a.removeSession("does-not-exist")
}

// --- readDRDAResponse test via pipe ---

func TestReadDRDAResponse_ValidPacket(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	// Build a valid DRDA response packet
	go func() {
		payload := []byte{0x01, 0x02}
		ddmLen := drdaDDMHeaderSize + len(payload)
		dssLen := drdaDSSHeaderSize + ddmLen

		pkt := make([]byte, dssLen)
		binary.BigEndian.PutUint16(pkt[0:2], uint16(dssLen))
		pkt[2] = 0xD0
		pkt[3] = 0x02 // response type
		binary.BigEndian.PutUint16(pkt[4:6], 1)

		binary.BigEndian.PutUint16(pkt[6:8], uint16(ddmLen))
		binary.BigEndian.PutUint16(pkt[8:10], ddmCodePointEXCSATRD)

		copy(pkt[10:], payload)
		server.Write(pkt)
	}()

	ctx := t.Context()
	err := readDRDAResponse(ctx, client, ddmCodePointEXCSATRD)
	if err != nil {
		t.Errorf("readDRDAResponse() = %v, want nil", err)
	}
}

func TestReadDRDAResponse_PacketTooShort(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	go func() {
		// DSS header with length too small to contain DDM
		pkt := make([]byte, drdaDSSHeaderSize)
		binary.BigEndian.PutUint16(pkt[0:2], uint16(drdaDSSHeaderSize)) // only DSS, no DDM
		pkt[2] = 0xD0
		pkt[3] = 0x02
		binary.BigEndian.PutUint16(pkt[4:6], 1)
		server.Write(pkt)
	}()

	ctx := t.Context()
	err := readDRDAResponse(ctx, client, ddmCodePointEXCSATRD)
	if err == nil {
		t.Fatal("readDRDAResponse() with short packet should return error")
	}
}

// findCodePointInPayload searches for a 2-byte code point in DRDA parameter blocks.
// Each parameter has: 2-byte length, 2-byte code point, variable data.
func findCodePointInPayload(data []byte, codePoint uint16) bool {
	offset := 0
	for offset+4 <= len(data) {
		paramLen := int(binary.BigEndian.Uint16(data[offset : offset+2]))
		cp := binary.BigEndian.Uint16(data[offset+2 : offset+4])
		if cp == codePoint {
			return true
		}
		if paramLen < 4 {
			break // avoid infinite loop on malformed data
		}
		offset += paramLen
	}
	return false
}
