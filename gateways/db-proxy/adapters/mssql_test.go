package adapters

import (
	"context"
	"encoding/binary"
	"testing"
)

func TestMSSQLAdapter_Protocol(t *testing.T) {
	a := NewMSSQLAdapter()
	if got := a.Protocol(); got != "mssql" {
		t.Errorf("Protocol() = %q, want %q", got, "mssql")
	}
}

func TestMSSQLAdapter_DefaultPort(t *testing.T) {
	a := NewMSSQLAdapter()
	if got := a.DefaultPort(); got != 1433 {
		t.Errorf("DefaultPort() = %d, want %d", got, 1433)
	}
}

func TestMSSQLAdapter_HealthCheck(t *testing.T) {
	a := NewMSSQLAdapter()
	if err := a.HealthCheck(); err != nil {
		t.Errorf("HealthCheck() = %v, want nil", err)
	}
}

func TestMSSQLAdapter_ActiveSessions_Empty(t *testing.T) {
	a := NewMSSQLAdapter()
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d, want 0", got)
	}
}

func TestMSSQLAdapter_Disconnect_NonExistent(t *testing.T) {
	a := NewMSSQLAdapter()
	// Should not panic on non-existent session.
	a.Disconnect("non-existent-session")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() after Disconnect = %d, want 0", got)
	}
}

func TestMSSQLAdapter_Forward_NonExistentSession(t *testing.T) {
	a := NewMSSQLAdapter()
	err := a.Forward(nil, "non-existent", nil)
	if err == nil {
		t.Fatal("Forward() with non-existent session should return error")
	}
}

// --- TDS packet construction tests ---

func TestMakeTDSPacket_Structure(t *testing.T) {
	tests := []struct {
		name    string
		pktType byte
		payload []byte
		eom     bool
	}{
		{
			name:    "empty payload with EOM",
			pktType: tdsPacketTypePreLogin,
			payload: []byte{},
			eom:     true,
		},
		{
			name:    "with payload and EOM",
			pktType: tdsPacketTypeLogin7,
			payload: []byte{0x01, 0x02, 0x03, 0x04},
			eom:     true,
		},
		{
			name:    "without EOM",
			pktType: tdsPacketTypeResponse,
			payload: []byte{0xAA, 0xBB},
			eom:     false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pkt := makeTDSPacket(tt.pktType, tt.payload, tt.eom)

			expectedLen := tdsHeaderSize + len(tt.payload)
			if len(pkt) != expectedLen {
				t.Fatalf("packet length = %d, want %d", len(pkt), expectedLen)
			}

			// Byte 0: packet type
			if pkt[0] != tt.pktType {
				t.Errorf("packet type = %d, want %d", pkt[0], tt.pktType)
			}

			// Byte 1: status (EOM flag)
			if tt.eom && pkt[1] != tdsStatusEOM {
				t.Errorf("status = 0x%02x, want 0x%02x (EOM)", pkt[1], tdsStatusEOM)
			}
			if !tt.eom && pkt[1] != 0 {
				t.Errorf("status = 0x%02x, want 0x00 (no EOM)", pkt[1])
			}

			// Bytes 2-3: total length (big-endian)
			gotLen := binary.BigEndian.Uint16(pkt[2:4])
			if gotLen != uint16(expectedLen) {
				t.Errorf("encoded length = %d, want %d", gotLen, expectedLen)
			}

			// Bytes 4-5: SPID (should be 0)
			if pkt[4] != 0 || pkt[5] != 0 {
				t.Errorf("SPID = [%d, %d], want [0, 0]", pkt[4], pkt[5])
			}

			// Byte 6: Packet ID (should be 1)
			if pkt[6] != 1 {
				t.Errorf("packet ID = %d, want 1", pkt[6])
			}

			// Byte 7: Window (should be 0)
			if pkt[7] != 0 {
				t.Errorf("window = %d, want 0", pkt[7])
			}

			// Payload matches
			for i, b := range tt.payload {
				if pkt[tdsHeaderSize+i] != b {
					t.Errorf("payload[%d] = 0x%02x, want 0x%02x", i, pkt[tdsHeaderSize+i], b)
				}
			}
		})
	}
}

func TestMakeTDSPacket_PreLoginType(t *testing.T) {
	pkt := makeTDSPacket(tdsPacketTypePreLogin, []byte{0xFF}, true)
	if pkt[0] != 18 {
		t.Errorf("PreLogin packet type = %d, want 18", pkt[0])
	}
}

func TestMakeTDSPacket_Login7Type(t *testing.T) {
	pkt := makeTDSPacket(tdsPacketTypeLogin7, []byte{}, true)
	if pkt[0] != 16 {
		t.Errorf("Login7 packet type = %d, want 16", pkt[0])
	}
}

func TestTDSConstants(t *testing.T) {
	tests := []struct {
		name     string
		got      int
		expected int
	}{
		{"tdsPacketTypePreLogin", tdsPacketTypePreLogin, 18},
		{"tdsPacketTypeLogin7", tdsPacketTypeLogin7, 16},
		{"tdsPacketTypeSSPI", tdsPacketTypeSSPI, 17},
		{"tdsPacketTypeResponse", tdsPacketTypeResponse, 4},
		{"tdsPacketTypeAttention", tdsPacketTypeAttention, 6},
		{"tdsPacketTypePreLoginResp", tdsPacketTypePreLoginResp, 0},
		{"tdsHeaderSize", tdsHeaderSize, 8},
		{"tdsStatusEOM", tdsStatusEOM, 0x01},
		{"mssqlDefaultPort", mssqlDefaultPort, 1433},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("%s = %d, want %d", tt.name, tt.got, tt.expected)
			}
		})
	}
}

// --- Login7 payload tests ---

func TestBuildLogin7Payload_Structure(t *testing.T) {
	payload := buildLogin7Payload("sa", "password123", "master", "")

	// Total length in first 4 bytes (LE)
	totalLen := binary.LittleEndian.Uint32(payload[0:4])
	if totalLen != uint32(len(payload)) {
		t.Errorf("login7 total length = %d, actual length = %d", totalLen, len(payload))
	}

	// TDS version at bytes 4-7
	tdsVer := binary.LittleEndian.Uint32(payload[4:8])
	if tdsVer != 0x74000004 {
		t.Errorf("TDS version = 0x%08x, want 0x74000004", tdsVer)
	}

	// Packet size at bytes 8-11
	pktSize := binary.LittleEndian.Uint32(payload[8:12])
	if pktSize != 4096 {
		t.Errorf("packet size = %d, want 4096", pktSize)
	}
}

func TestBuildLogin7Payload_UsernameOffset(t *testing.T) {
	username := "testuser"
	payload := buildLogin7Payload(username, "pass", "db", "")

	// Username offset at bytes 36-37 (LE)
	offset := binary.LittleEndian.Uint16(payload[36:38])
	// Username length (in characters) at bytes 38-39
	length := binary.LittleEndian.Uint16(payload[38:40])

	if offset != 94 { // fixed header is 94 bytes
		t.Errorf("username offset = %d, want 94", offset)
	}
	if length != uint16(len(username)) {
		t.Errorf("username length = %d, want %d", length, len(username))
	}
}

func TestBuildLogin7Payload_PasswordOffset(t *testing.T) {
	username := "sa"
	password := "secret"
	payload := buildLogin7Payload(username, password, "db", "")

	// Password offset at bytes 40-41 (LE)
	pwdOffset := binary.LittleEndian.Uint16(payload[40:42])
	// Password length at bytes 42-43
	pwdLength := binary.LittleEndian.Uint16(payload[42:44])

	expectedOffset := 94 + len(username)*2 // after fixed header + username UTF16
	if pwdOffset != uint16(expectedOffset) {
		t.Errorf("password offset = %d, want %d", pwdOffset, expectedOffset)
	}
	if pwdLength != uint16(len(password)) {
		t.Errorf("password length = %d, want %d", pwdLength, len(password))
	}
}

func TestBuildLogin7Payload_DatabaseOffset(t *testing.T) {
	username := "sa"
	password := "pwd"
	database := "mydb"
	payload := buildLogin7Payload(username, password, database, "")

	dbOffset := binary.LittleEndian.Uint16(payload[48:50])
	dbLength := binary.LittleEndian.Uint16(payload[50:52])

	expectedOffset := 94 + len(username)*2 + len(password)*2
	if dbOffset != uint16(expectedOffset) {
		t.Errorf("database offset = %d, want %d", dbOffset, expectedOffset)
	}
	if dbLength != uint16(len(database)) {
		t.Errorf("database length = %d, want %d", dbLength, len(database))
	}
}

func TestBuildLogin7Payload_WithInstanceName(t *testing.T) {
	username := "sa"
	password := "pwd"
	database := "db"
	instance := "INST1"
	payload := buildLogin7Payload(username, password, database, instance)

	instOffset := binary.LittleEndian.Uint16(payload[44:46])
	instLength := binary.LittleEndian.Uint16(payload[46:48])

	expectedOffset := 94 + len(username)*2 + len(password)*2 + len(database)*2
	if instOffset != uint16(expectedOffset) {
		t.Errorf("instance offset = %d, want %d", instOffset, expectedOffset)
	}
	if instLength != uint16(len(instance)) {
		t.Errorf("instance length = %d, want %d", instLength, len(instance))
	}
}

func TestBuildLogin7Payload_EmptyInstanceName(t *testing.T) {
	payload := buildLogin7Payload("sa", "pwd", "db", "")

	// Instance offset/length at bytes 44-47 should be zero when empty
	instOffset := binary.LittleEndian.Uint16(payload[44:46])
	instLength := binary.LittleEndian.Uint16(payload[46:48])

	if instOffset != 0 || instLength != 0 {
		t.Errorf("empty instance: offset=%d, length=%d, want both 0", instOffset, instLength)
	}
}

// --- UTF-16LE conversion tests ---

func TestStringToUTF16LE(t *testing.T) {
	tests := []struct {
		input    string
		expected []byte
	}{
		{"", []byte{}},
		{"A", []byte{0x41, 0x00}},
		{"ab", []byte{0x61, 0x00, 0x62, 0x00}},
		{"sa", []byte{0x73, 0x00, 0x61, 0x00}},
		{"123", []byte{0x31, 0x00, 0x32, 0x00, 0x33, 0x00}},
	}

	for _, tt := range tests {
		t.Run(tt.input, func(t *testing.T) {
			got := stringToUTF16LE(tt.input)
			if len(got) != len(tt.expected) {
				t.Fatalf("len = %d, want %d", len(got), len(tt.expected))
			}
			for i, b := range tt.expected {
				if got[i] != b {
					t.Errorf("byte[%d] = 0x%02x, want 0x%02x", i, got[i], b)
				}
			}
		})
	}
}

func TestStringToUTF16LE_Length(t *testing.T) {
	// Each ASCII character should produce 2 bytes
	s := "hello"
	got := stringToUTF16LE(s)
	if len(got) != len(s)*2 {
		t.Errorf("len(UTF16LE(%q)) = %d, want %d", s, len(got), len(s)*2)
	}
}

// --- Session management tests ---

func TestMSSQLAdapter_SessionLifecycle(t *testing.T) {
	a := NewMSSQLAdapter()

	if a.ActiveSessions() != 0 {
		t.Fatalf("initial ActiveSessions() = %d, want 0", a.ActiveSessions())
	}

	// Simulate adding a session manually (bypassing Connect which needs a real server)
	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())

	a.mu.Lock()
	a.sessions["sess-1"] = &mssqlSession{id: "sess-1", cancel: cancel1}
	a.sessions["sess-2"] = &mssqlSession{id: "sess-2", cancel: cancel2}
	a.mu.Unlock()

	if got := a.ActiveSessions(); got != 2 {
		t.Errorf("ActiveSessions() = %d, want 2", got)
	}

	// Disconnect one
	a.removeSession("sess-1")
	if got := a.ActiveSessions(); got != 1 {
		t.Errorf("after remove: ActiveSessions() = %d, want 1", got)
	}

	// Disconnect remaining
	a.removeSession("sess-2")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("after remove all: ActiveSessions() = %d, want 0", got)
	}
}

func TestMSSQLAdapter_RemoveSession_Idempotent(t *testing.T) {
	a := NewMSSQLAdapter()
	// Removing non-existent session should not panic
	a.removeSession("does-not-exist")
	a.removeSession("does-not-exist")
}
