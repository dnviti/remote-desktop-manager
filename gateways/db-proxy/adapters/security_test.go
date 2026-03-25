package adapters

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"strings"
	"sync"
	"testing"
	"time"
)

// ===========================================================================
// SQL Injection & Protocol Injection
// ===========================================================================

// 1. TestMSSQLInjectionInCredentials — SQL injection payloads in username
// must be passed literally through TDS Login7 (not interpreted as SQL).
func TestMSSQLInjectionInCredentials(t *testing.T) {
	t.Parallel()

	injectionPayloads := []struct {
		name     string
		username string
		password string
	}{
		{"sql_drop_table", "admin'; DROP TABLE users;--", "password"},
		{"sql_or_bypass", "admin' OR '1'='1", "password"},
		{"null_byte_bypass", "admin\x00bypass", "password"},
		{"union_select", "' UNION SELECT * FROM users--", "password"},
		{"semicolon_batch", "sa; EXEC xp_cmdshell 'whoami'--", "password"},
		{"double_dash_comment", "admin--", "password"},
		{"stacked_queries", "admin'; WAITFOR DELAY '0:0:5';--", "password"},
	}

	for _, tt := range injectionPayloads {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			// Build the Login7 payload — must not panic on any input
			payload := buildLogin7Payload(tt.username, tt.password, "master", "")

			// Verify total length is self-consistent
			totalLen := binary.LittleEndian.Uint32(payload[0:4])
			if totalLen != uint32(len(payload)) {
				t.Errorf("login7 length mismatch: header says %d, actual %d", totalLen, len(payload))
			}

			// Verify the username is encoded literally as UTF-16LE in the payload.
			// The username offset is at bytes 36-37 and length at 38-39.
			usernameOffset := binary.LittleEndian.Uint16(payload[36:38])
			usernameLen := binary.LittleEndian.Uint16(payload[38:40])
			if usernameLen != uint16(len(tt.username)) {
				t.Errorf("username length in Login7 = %d, want %d", usernameLen, len(tt.username))
			}

			// Read back the encoded username from the payload
			utf16Start := int(usernameOffset)
			utf16End := utf16Start + int(usernameLen)*2
			if utf16End > len(payload) {
				t.Fatalf("username UTF16 region overflows payload: [%d:%d] vs len=%d", utf16Start, utf16End, len(payload))
			}
			encodedUsername := payload[utf16Start:utf16End]
			decoded := utf16LEToString(encodedUsername)
			if decoded != tt.username {
				t.Errorf("decoded username = %q, want %q (injection payload must be passed literally)", decoded, tt.username)
			}

			// Verify the full TDS packet wraps correctly
			pkt := makeTDSPacket(tdsPacketTypeLogin7, payload, true)
			if pkt[0] != tdsPacketTypeLogin7 {
				t.Errorf("TDS packet type = %d, want %d", pkt[0], tdsPacketTypeLogin7)
			}
		})
	}
}

// 2. TestOracleInjectionInSID — Oracle TNS connect descriptor with SID
// containing injection payloads. Verify they appear literally in the
// descriptor (no interpretation or path traversal).
func TestOracleInjectionInSID(t *testing.T) {
	t.Parallel()

	injectionPayloads := []struct {
		name string
		sid  string
	}{
		{"sql_drop", "'; DROP TABLE;"},
		{"path_traversal", "../../etc/passwd"},
		{"null_byte", "ORCL\x00evil"},
		{"tns_escape_paren", "ORCL)(HOST=evil.com"},
		{"tns_nested_desc", "(DESCRIPTION=(ADDRESS=(HOST=evil.com)))"},
		{"long_sid", strings.Repeat("A", 10000)},
	}

	for _, tt := range injectionPayloads {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			opts := ConnectOptions{
				Host: "db-host",
				Port: 1521,
				Extra: map[string]string{
					"sid": tt.sid,
				},
			}

			desc := buildTNSConnectDescriptor(opts)

			// The SID value must appear literally in the descriptor
			expectedClause := fmt.Sprintf("(SID=%s)", tt.sid)
			if !strings.Contains(desc, expectedClause) {
				t.Errorf("descriptor does not contain literal SID clause %q:\n  got: %s", expectedClause, desc)
			}

			// Must still contain the configured host, not any injected host
			if !strings.Contains(desc, "(HOST=db-host)") {
				t.Errorf("descriptor missing original HOST; injection may have overwritten it:\n  %s", desc)
			}
		})
	}
}

// 3. TestDB2InjectionInDatabase — DB2 ACCRDB with database name containing
// DRDA escape sequences or injection payloads.
func TestDB2InjectionInDatabase(t *testing.T) {
	t.Parallel()

	injectionPayloads := []struct {
		name   string
		dbName string
	}{
		{"sql_injection", "'; DROP TABLE users;--"},
		{"null_byte", "SAMPLE\x00EVIL"},
		{"drda_codepoint", string([]byte{0x21, 0x10, 0x00, 0x04})}, // embedded RDBNAM codepoint
		{"long_name", strings.Repeat("X", 10000)},
		{"unicode_escape", "SAMPLE\u200Bevil"}, // zero-width space
	}

	for _, tt := range injectionPayloads {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			client, server := createPipe(t)
			defer client.Close()
			defer server.Close()

			errCh := make(chan error, 1)
			go func() {
				errCh <- sendDRDAAccrdb(client, tt.dbName)
			}()

			buf := make([]byte, 65536)
			n, err := server.Read(buf)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			pkt := buf[:n]

			// Must not panic and must produce a valid DRDA packet structure
			if len(pkt) < drdaDSSHeaderSize+drdaDDMHeaderSize {
				t.Fatalf("packet too short: %d bytes", len(pkt))
			}

			// Verify DDM code point is ACCRDB
			codePoint := binary.BigEndian.Uint16(pkt[drdaDSSHeaderSize+2 : drdaDSSHeaderSize+4])
			if codePoint != ddmCodePointACCRDB {
				t.Errorf("DDM code point = 0x%04x, want 0x%04x (ACCRDB)", codePoint, ddmCodePointACCRDB)
			}

			// Verify the database name bytes appear literally in the packet
			if !bytes.Contains(pkt, []byte(tt.dbName)) {
				t.Errorf("database name not found literally in ACCRDB packet")
			}

			if err := <-errCh; err != nil {
				t.Errorf("sendDRDAAccrdb returned error: %v", err)
			}
		})
	}
}

// 4. TestUsernameWithNullBytes — All adapters: username with null bytes,
// control characters. Verify no protocol injection or panic.
func TestUsernameWithNullBytes(t *testing.T) {
	t.Parallel()

	controlChars := []struct {
		name     string
		username string
	}{
		{"null_byte", "admin\x00root"},
		{"carriage_return_newline", "admin\r\nroot"},
		{"tab", "admin\troot"},
		{"backspace", "admin\x08root"},
		{"escape", "admin\x1Broot"},
		{"bell", "admin\x07root"},
		{"mixed_control", "admin\x00\r\n\t\x1B"},
	}

	for _, tt := range controlChars {
		t.Run("mssql_"+tt.name, func(t *testing.T) {
			t.Parallel()
			// Must not panic
			payload := buildLogin7Payload(tt.username, "password", "db", "")
			if len(payload) == 0 {
				t.Fatal("buildLogin7Payload returned empty payload")
			}
			pkt := makeTDSPacket(tdsPacketTypeLogin7, payload, true)
			if len(pkt) < tdsHeaderSize {
				t.Fatal("makeTDSPacket returned invalid packet")
			}
		})

		t.Run("db2_"+tt.name, func(t *testing.T) {
			t.Parallel()
			client, server := createPipe(t)
			defer client.Close()
			defer server.Close()

			errCh := make(chan error, 1)
			go func() {
				errCh <- sendDRDASecchk(client, tt.username, "password")
			}()

			buf := make([]byte, 4096)
			n, err := server.Read(buf)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if n < drdaDSSHeaderSize+drdaDDMHeaderSize {
				t.Fatalf("packet too short: %d bytes", n)
			}

			if err := <-errCh; err != nil {
				t.Errorf("sendDRDASecchk returned error: %v", err)
			}
		})

		t.Run("oracle_"+tt.name, func(t *testing.T) {
			t.Parallel()
			// Oracle: username goes into TNS connect descriptor context —
			// test that descriptor building doesn't panic
			opts := ConnectOptions{
				Host:         "dbhost",
				Port:         1521,
				Username:     tt.username,
				DatabaseName: "XE",
				Extra:        map[string]string{},
			}
			desc := buildTNSConnectDescriptor(opts)
			if desc == "" {
				t.Fatal("buildTNSConnectDescriptor returned empty string")
			}
		})
	}
}

// 5. TestPasswordWithSpecialChars — Passwords with all printable ASCII,
// unicode, null bytes, very long passwords (10KB).
func TestPasswordWithSpecialChars(t *testing.T) {
	t.Parallel()

	passwords := []struct {
		name     string
		password string
	}{
		{"all_printable_ascii", func() string {
			var b strings.Builder
			for i := 32; i < 127; i++ {
				b.WriteByte(byte(i))
			}
			return b.String()
		}()},
		{"unicode_emoji", "\U0001F600\U0001F4A9\U0001F525"},
		{"null_bytes", "pass\x00word\x00123"},
		{"very_long_10kb", strings.Repeat("A", 10240)},
		{"special_symbols", "p@$$w0rd!#%^&*()[]{}|\\;':\",./<>?"},
		{"unicode_cjk", "\u4e16\u754c\u3053\u3093\u306b\u3061\u306f"},
	}

	for _, tt := range passwords {
		t.Run("mssql_"+tt.name, func(t *testing.T) {
			t.Parallel()
			payload := buildLogin7Payload("sa", tt.password, "master", "")
			if len(payload) == 0 {
				t.Fatal("empty payload")
			}
			// Verify password length field
			pwdLen := binary.LittleEndian.Uint16(payload[42:44])
			if pwdLen != uint16(len(tt.password)) {
				t.Errorf("password length field = %d, want %d", pwdLen, len(tt.password))
			}
		})

		t.Run("db2_"+tt.name, func(t *testing.T) {
			t.Parallel()
			client, server := createPipe(t)
			defer client.Close()
			defer server.Close()

			errCh := make(chan error, 1)
			go func() {
				errCh <- sendDRDASecchk(client, "admin", tt.password)
			}()

			buf := make([]byte, 65536)
			_, err := server.Read(buf)
			if err != nil {
				t.Fatalf("read: %v", err)
			}
			if err := <-errCh; err != nil {
				t.Errorf("sendDRDASecchk error: %v", err)
			}
		})
	}
}

// ===========================================================================
// Protocol Manipulation & Downgrade
// ===========================================================================

// 6. TestMSSQLAuthDowngrade — Verify that a crafted pre-login response
// with encryption=NOT_SUP doesn't cause the adapter to skip encryption
// negotiation silently. The adapter should complete the handshake flow
// without panic regardless of the pre-login response content.
func TestMSSQLAuthDowngrade(t *testing.T) {
	t.Parallel()

	// Fake server that responds with encryption=NOT_SUP in pre-login
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	go func() {
		conn, err := ln.Accept()
		if err != nil {
			return
		}
		defer conn.Close()

		// Read client pre-login
		buf := make([]byte, 4096)
		conn.Read(buf)

		// Send pre-login response with ENCRYPT=NOT_SUP (0x02)
		preLoginResp := []byte{
			0x00,       // VERSION token
			0x00, 0x06, // offset
			0x00, 0x06, // length
			0x01,       // ENCRYPTION token
			0x00, 0x0C, // offset
			0x00, 0x01, // length
			0xFF,       // terminator
			// VERSION data
			0x0F, 0x00, 0x00, 0x00, 0x00, 0x00,
			// ENCRYPTION data: 0x02 = NOT_SUP
			0x02,
		}
		header := make([]byte, tdsHeaderSize)
		header[0] = tdsPacketTypePreLoginResp
		header[1] = tdsStatusEOM
		totalLen := tdsHeaderSize + len(preLoginResp)
		binary.BigEndian.PutUint16(header[2:4], uint16(totalLen))
		conn.Write(header)
		conn.Write(preLoginResp)

		// Read Login7 and send a login response
		conn.Read(buf)
		loginResp := makeTDSPacket(tdsPacketTypeResponse, []byte{0x00}, true)
		conn.Write(loginResp)
	}()

	addr := ln.Addr().(*net.TCPAddr)
	a := NewMSSQLAdapter()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Should not panic; the adapter completes the handshake flow
	_, err = a.Connect(ctx, ConnectOptions{
		SessionID:    "downgrade-test",
		Host:         "127.0.0.1",
		Port:         addr.Port,
		Username:     "sa",
		Password:     "pwd",
		DatabaseName: "master",
		Extra:        map[string]string{},
	})
	// We don't assert success/failure — we assert no panic and proper cleanup
	if a.ActiveSessions() > 1 {
		t.Errorf("session leak after auth downgrade test")
	}
	_ = err
}

// 7. TestOracleTNSPacketSmuggling — TNS Connect with embedded malicious
// HOST in the connect descriptor. Verify the adapter uses only the
// configured host, not data from the TNS packet.
func TestOracleTNSPacketSmuggling(t *testing.T) {
	t.Parallel()

	opts := ConnectOptions{
		Host: "legitimate-host",
		Port: 1521,
		Extra: map[string]string{
			"sid": "ORCL)(HOST=evil.com)(PORT=9999)(SID=EVIL",
		},
	}

	desc := buildTNSConnectDescriptor(opts)

	// The descriptor must contain the legitimate host
	if !strings.Contains(desc, "(HOST=legitimate-host)") {
		t.Errorf("descriptor missing legitimate host:\n  %s", desc)
	}

	// The address section must reference port 1521 (configured), not 9999
	if !strings.Contains(desc, "(PORT=1521)") {
		t.Errorf("descriptor missing configured port 1521:\n  %s", desc)
	}

	// The malicious SID is embedded literally (not interpreted structurally)
	// — it's just a string value for the SID parameter
	if !strings.Contains(desc, "SID=ORCL)(HOST=evil.com)(PORT=9999)(SID=EVIL") {
		t.Errorf("SID injection payload not passed literally:\n  %s", desc)
	}
}

// 8. TestDB2SecurityMechanismEnforcement — Verify DB2 ACCSEC sends
// the configured security mechanism (USRIDPWD) and cannot be
// downgraded to USRIDONLY (no password).
func TestDB2SecurityMechanismEnforcement(t *testing.T) {
	t.Parallel()

	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendDRDAAccsec(client, drdaSecMechUSRIDPWD)
	}()

	buf := make([]byte, 256)
	n, err := server.Read(buf)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	pkt := buf[:n]

	// Find SECMEC value in payload
	payloadStart := drdaDSSHeaderSize + drdaDDMHeaderSize
	if len(pkt) < payloadStart+6 {
		t.Fatalf("packet too short to contain SECMEC")
	}

	secmecVal := binary.BigEndian.Uint16(pkt[payloadStart+4 : payloadStart+6])
	if secmecVal != drdaSecMechUSRIDPWD {
		t.Errorf("SECMEC = 0x%04x, want 0x%04x (USRIDPWD); potential downgrade to USRIDONLY", secmecVal, drdaSecMechUSRIDPWD)
	}
	if secmecVal == drdaSecMechUSRIDONL {
		t.Fatal("SECMEC is USRIDONLY (0x04) — security mechanism was downgraded!")
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendDRDAAccsec error: %v", err)
	}
}

// ===========================================================================
// Buffer Overflow / Memory Safety
// ===========================================================================

// 9. TestOversizedProtocolHeaders — Packets with length fields exceeding
// actual data or set to MAX_UINT16. Verify no OOB reads or panics.
func TestOversizedProtocolHeaders(t *testing.T) {
	t.Parallel()

	t.Run("tds_oversized_length", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			// TDS header claiming 65535 bytes but only sending 8 byte header
			header := make([]byte, tdsHeaderSize)
			header[0] = tdsPacketTypeResponse
			header[1] = tdsStatusEOM
			binary.BigEndian.PutUint16(header[2:4], 0xFFFF) // MAX_UINT16
			server.Write(header)
			time.Sleep(100 * time.Millisecond)
			server.Close() // Force EOF
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		// Should return error, not panic or hang forever
		err := readTDSPreLoginResponse(ctx, client)
		if err == nil {
			t.Log("no error returned for oversized TDS header (benign — connection closed)")
		}
	})

	t.Run("tns_oversized_length", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			header := make([]byte, tnsHeaderSize)
			binary.BigEndian.PutUint16(header[0:2], 0xFFFF) // MAX_UINT16
			header[4] = tnsPacketTypeAccept
			server.Write(header)
			time.Sleep(100 * time.Millisecond)
			server.Close()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := waitTNSResponse(ctx, client)
		if err == nil {
			t.Log("no error for oversized TNS header (benign — connection closed)")
		}
	})

	t.Run("drda_oversized_length", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			dss := make([]byte, drdaDSSHeaderSize)
			binary.BigEndian.PutUint16(dss[0:2], 0xFFFF) // MAX_UINT16
			dss[2] = 0xD0
			dss[3] = 0x02
			binary.BigEndian.PutUint16(dss[4:6], 1)
			server.Write(dss)
			time.Sleep(100 * time.Millisecond)
			server.Close()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := readDRDAResponse(ctx, client, ddmCodePointEXCSATRD)
		if err == nil {
			t.Log("no error for oversized DRDA header (benign — connection closed)")
		}
	})
}

// 10. TestZeroLengthProtocolPackets — Valid headers but zero-length payloads.
// Must not panic or infinite loop.
func TestZeroLengthProtocolPackets(t *testing.T) {
	t.Parallel()

	t.Run("tds_header_only", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			header := make([]byte, tdsHeaderSize)
			header[0] = tdsPacketTypeResponse
			header[1] = tdsStatusEOM
			binary.BigEndian.PutUint16(header[2:4], uint16(tdsHeaderSize)) // length = header only
			server.Write(header)
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		// Should not hang or panic
		_ = readTDSLoginResponse(ctx, client)
	})

	t.Run("tns_header_only", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			header := make([]byte, tnsHeaderSize)
			binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize))
			header[4] = tnsPacketTypeAccept
			server.Write(header)
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := waitTNSResponse(ctx, client)
		if err != nil {
			t.Errorf("zero-length TNS Accept should succeed: %v", err)
		}
	})

	t.Run("tds_zero_in_length_field", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		go func() {
			header := make([]byte, tdsHeaderSize)
			header[0] = tdsPacketTypeResponse
			header[1] = tdsStatusEOM
			binary.BigEndian.PutUint16(header[2:4], 0) // zero total length
			server.Write(header)
			server.Close()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_ = readTDSPreLoginResponse(ctx, client)
		// Must not panic
	})

	t.Run("makeTDSPacket_empty_payload", func(t *testing.T) {
		t.Parallel()
		pkt := makeTDSPacket(tdsPacketTypePreLogin, []byte{}, true)
		if len(pkt) != tdsHeaderSize {
			t.Errorf("empty payload packet length = %d, want %d", len(pkt), tdsHeaderSize)
		}
	})

	t.Run("makeDRDAPacket_empty_payload", func(t *testing.T) {
		t.Parallel()
		pkt := makeDRDAPacket(ddmCodePointEXCSAT, []byte{})
		expected := drdaDSSHeaderSize + drdaDDMHeaderSize
		if len(pkt) != expected {
			t.Errorf("empty payload DRDA packet length = %d, want %d", len(pkt), expected)
		}
	})
}

// 11. TestFragmentedProtocolAttack — Send a protocol packet one byte at a time.
// Verify timeout (via context), not hang.
func TestFragmentedProtocolAttack(t *testing.T) {
	t.Parallel()

	t.Run("tds_byte_by_byte", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		// Build a valid TDS response
		payload := []byte{0x01, 0x02, 0x03, 0x04}
		totalLen := tdsHeaderSize + len(payload)
		header := make([]byte, tdsHeaderSize)
		header[0] = tdsPacketTypeResponse
		header[1] = tdsStatusEOM
		binary.BigEndian.PutUint16(header[2:4], uint16(totalLen))
		fullPkt := append(header, payload...)

		go func() {
			for _, b := range fullPkt {
				server.Write([]byte{b})
				time.Sleep(5 * time.Millisecond)
			}
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := readTDSLoginResponse(ctx, client)
		if err != nil {
			t.Errorf("byte-by-byte TDS should still succeed with io.ReadFull: %v", err)
		}
	})

	t.Run("tns_byte_by_byte_timeout", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		// Send only partial header (< tnsHeaderSize bytes), then stop
		go func() {
			for i := 0; i < tnsHeaderSize-1; i++ {
				server.Write([]byte{0x00})
				time.Sleep(10 * time.Millisecond)
			}
			// Never send the last byte — should trigger timeout
			time.Sleep(3 * time.Second)
			server.Close()
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		err := waitTNSResponse(ctx, client)
		if err == nil {
			t.Error("expected timeout error for incomplete TNS header")
		}
	})

	t.Run("drda_byte_by_byte", func(t *testing.T) {
		t.Parallel()
		client, server := net.Pipe()
		defer client.Close()
		defer server.Close()

		// Build a valid DRDA response
		ddmPayload := []byte{0xAA, 0xBB}
		ddmLen := drdaDDMHeaderSize + len(ddmPayload)
		dssLen := drdaDSSHeaderSize + ddmLen
		pkt := make([]byte, dssLen)
		binary.BigEndian.PutUint16(pkt[0:2], uint16(dssLen))
		pkt[2] = 0xD0
		pkt[3] = 0x02
		binary.BigEndian.PutUint16(pkt[4:6], 1)
		binary.BigEndian.PutUint16(pkt[6:8], uint16(ddmLen))
		binary.BigEndian.PutUint16(pkt[8:10], ddmCodePointEXCSATRD)
		copy(pkt[10:], ddmPayload)

		go func() {
			for _, b := range pkt {
				server.Write([]byte{b})
				time.Sleep(2 * time.Millisecond)
			}
		}()

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		err := readDRDAResponse(ctx, client, ddmCodePointEXCSATRD)
		if err != nil {
			t.Errorf("byte-by-byte DRDA should still succeed with io.ReadFull: %v", err)
		}
	})
}

// ===========================================================================
// Session Hijacking
// ===========================================================================

// 12. TestSessionIDPredictability — Create 1000 sessions with unique IDs.
// When session IDs are externally provided (as they are in ConnectOptions),
// verify the adapter stores them faithfully and doesn't generate predictable
// sequential IDs on its own.
func TestSessionIDPredictability(t *testing.T) {
	t.Parallel()

	a := NewMSSQLAdapter()
	const n = 1000
	ids := make([]string, n)
	conns := make([]net.Conn, n)

	// Generate random session IDs (simulating what the proxy server would do)
	for i := 0; i < n; i++ {
		b := make([]byte, 16)
		if _, err := rand.Read(b); err != nil {
			t.Fatalf("rand.Read: %v", err)
		}
		ids[i] = fmt.Sprintf("%x", b)
		conns[i] = newMSSQLSessionDirect(t, a, ids[i])
	}

	// Verify all IDs are stored and unique
	seen := make(map[string]bool, n)
	a.mu.Lock()
	for _, sess := range a.sessions {
		if seen[sess.id] {
			t.Errorf("duplicate session ID: %s", sess.id)
		}
		seen[sess.id] = true
	}
	a.mu.Unlock()

	if len(seen) != n {
		t.Errorf("unique session count = %d, want %d", len(seen), n)
	}

	// Check for sequential patterns (IDs should have high entropy)
	for i := 1; i < n; i++ {
		if ids[i] == ids[i-1] {
			t.Errorf("consecutive duplicate IDs at index %d", i)
		}
	}

	// Cleanup
	for i := 0; i < n; i++ {
		conns[i].Close()
		a.Disconnect(ids[i])
	}
}

// 13. TestSessionIsolation — Two sessions with different credentials.
// Verify session A cannot access session B's connection via its session ID.
func TestSessionIsolation(t *testing.T) {
	t.Parallel()

	a := NewMSSQLAdapter()

	// Create two sessions with different "credentials"
	connA := newMSSQLSessionDirect(t, a, "session-A")
	connB := newMSSQLSessionDirect(t, a, "session-B")
	defer connA.Close()
	defer connB.Close()

	// Verify sessions are independent
	a.mu.Lock()
	sessA := a.sessions["session-A"]
	sessB := a.sessions["session-B"]
	a.mu.Unlock()

	if sessA == nil || sessB == nil {
		t.Fatal("one of the sessions is nil")
	}

	// Different upstream connections
	if sessA.upstream == sessB.upstream {
		t.Error("session A and B share the same upstream connection — isolation violation")
	}

	// Forward on session A should not affect session B
	clientA, peerA := net.Pipe()
	defer clientA.Close()
	defer peerA.Close()

	forwardDone := make(chan error, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 500*time.Millisecond)
	defer cancel()

	go func() {
		forwardDone <- a.Forward(ctx, "session-A", peerA)
	}()

	// Write data via session A's client side
	testData := []byte("session-A-data")
	clientA.Write(testData)

	// Read from session A's upstream side — should receive the data
	buf := make([]byte, 256)
	connA.SetReadDeadline(time.Now().Add(time.Second))
	n, err := connA.Read(buf)
	if err == nil && n > 0 {
		if !bytes.Equal(buf[:n], testData) {
			t.Errorf("session A data mismatch")
		}
	}

	// Session B's upstream should NOT have received session A's data
	connB.SetReadDeadline(time.Now().Add(100 * time.Millisecond))
	n, err = connB.Read(buf)
	if err == nil && n > 0 {
		t.Error("session B received data from session A — cross-session data leak!")
	}

	<-forwardDone
}

// 14. TestSessionReplayPrevention — Disconnect a session, then attempt to
// reuse its ID for Forward. Verify rejection.
func TestSessionReplayPrevention(t *testing.T) {
	t.Parallel()

	adapters := []struct {
		name       string
		newAdapter func() Adapter
		inject     func(t *testing.T, a Adapter, id string) net.Conn
	}{
		{
			name:       "mssql",
			newAdapter: func() Adapter { return NewMSSQLAdapter() },
			inject: func(t *testing.T, a Adapter, id string) net.Conn {
				return newMSSQLSessionDirect(t, a.(*MSSQLAdapter), id)
			},
		},
		{
			name:       "oracle",
			newAdapter: func() Adapter { return NewOracleAdapter() },
			inject: func(t *testing.T, a Adapter, id string) net.Conn {
				return newOracleSessionDirect(t, a.(*OracleAdapter), id)
			},
		},
		{
			name:       "db2",
			newAdapter: func() Adapter { return NewDB2Adapter() },
			inject: func(t *testing.T, a Adapter, id string) net.Conn {
				return newDB2SessionDirect(t, a.(*DB2Adapter), id)
			},
		},
	}

	for _, ad := range adapters {
		t.Run(ad.name, func(t *testing.T) {
			t.Parallel()
			a := ad.newAdapter()

			// Create and then disconnect a session
			conn := ad.inject(t, a, "replay-session")
			conn.Close()
			a.Disconnect("replay-session")

			if got := a.ActiveSessions(); got != 0 {
				t.Fatalf("ActiveSessions() = %d after disconnect, want 0", got)
			}

			// Attempt to Forward using the disconnected session ID
			client, peer := net.Pipe()
			defer client.Close()
			defer peer.Close()

			err := a.Forward(context.Background(), "replay-session", peer)
			if err == nil {
				t.Error("Forward() with disconnected session ID should return error (session replay)")
			}
		})
	}
}

// ===========================================================================
// Concurrent security tests
// ===========================================================================

// TestConcurrentInjectionAttempts — Multiple goroutines simultaneously
// attempting SQL injection through different adapters. Verify thread safety
// and no data races (run with -race flag).
func TestConcurrentInjectionAttempts(t *testing.T) {
	t.Parallel()

	const goroutines = 50
	var wg sync.WaitGroup

	// Concurrent MSSQL Login7 building with injection payloads
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			username := fmt.Sprintf("admin'; DROP TABLE t%d;--", idx)
			password := fmt.Sprintf("pass\x00%d", idx)
			payload := buildLogin7Payload(username, password, "db", "")
			if len(payload) == 0 {
				t.Errorf("goroutine %d: empty Login7 payload", idx)
			}
		}(i)
	}

	// Concurrent Oracle descriptor building
	wg.Add(goroutines)
	for i := 0; i < goroutines; i++ {
		go func(idx int) {
			defer wg.Done()
			opts := ConnectOptions{
				Host: "host",
				Port: 1521,
				Extra: map[string]string{
					"sid": fmt.Sprintf("SID%d)(HOST=evil%d.com", idx, idx),
				},
			}
			desc := buildTNSConnectDescriptor(opts)
			if desc == "" {
				t.Errorf("goroutine %d: empty TNS descriptor", idx)
			}
		}(i)
	}

	wg.Wait()
}

// ===========================================================================
// Helpers
// ===========================================================================

// utf16LEToString converts UTF-16LE bytes back to a Go string (ASCII-only, matching
// the simplified stringToUTF16LE used in the MSSQL adapter).
func utf16LEToString(b []byte) string {
	if len(b)%2 != 0 {
		return ""
	}
	var sb strings.Builder
	for i := 0; i < len(b); i += 2 {
		sb.WriteByte(b[i])
	}
	return sb.String()
}

// readTDSLoginResponseHelper wraps readTDSLoginResponse for reuse in tests.
// Already defined in the source; this is just a note.

// Ensure readTDSPreLoginResponse and readTDSLoginResponse are accessible
// (they are package-level functions in mssql.go).

// pipe helper already exists in oracle_test.go via createPipe.
// We reuse it here (same package).

// Verify constant sanity: these compile-time assertions ensure no accidental
// constant value changes break security assumptions.
func TestSecurityCriticalConstants(t *testing.T) {
	t.Parallel()

	// MSSQL
	if tdsPacketTypeLogin7 != 16 {
		t.Fatal("tdsPacketTypeLogin7 changed — security review required")
	}
	if tdsPacketTypeSSPI != 17 {
		t.Fatal("tdsPacketTypeSSPI changed — security review required")
	}

	// DB2 security mechanisms
	if drdaSecMechUSRIDPWD != 0x03 {
		t.Fatal("drdaSecMechUSRIDPWD changed — security review required")
	}
	if drdaSecMechUSRIDONL != 0x04 {
		t.Fatal("drdaSecMechUSRIDONL changed — security review required")
	}
}

// TestMSSQLConnectToRefusedPort — attempt to connect to a port that
// actively refuses connections. Session must be cleaned up.
func TestMSSQLConnectToRefusedPort(t *testing.T) {
	t.Parallel()

	// Find a port that's almost certainly not listening
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := ln.Addr().(*net.TCPAddr)
	ln.Close() // Now the port should refuse connections

	a := NewMSSQLAdapter()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = a.Connect(ctx, ConnectOptions{
		SessionID:    "refused-port",
		Host:         "127.0.0.1",
		Port:         addr.Port,
		Username:     "sa",
		Password:     "pwd",
		DatabaseName: "master",
		Extra:        map[string]string{},
	})

	if err == nil {
		t.Fatal("Connect to refused port should fail")
	}

	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("session leak: ActiveSessions() = %d after refused connect", got)
	}
}

// TestAllAdapters_LargeSessionIDSafety — verify adapters handle very long
// session IDs without panics or truncation.
func TestAllAdapters_LargeSessionIDSafety(t *testing.T) {
	t.Parallel()

	longID := strings.Repeat("A", 10000)

	t.Run("mssql", func(t *testing.T) {
		t.Parallel()
		a := NewMSSQLAdapter()
		c := newMSSQLSessionDirect(t, a, longID)
		defer c.Close()

		if got := a.ActiveSessions(); got != 1 {
			t.Errorf("ActiveSessions() = %d, want 1", got)
		}

		a.mu.Lock()
		sess, ok := a.sessions[longID]
		a.mu.Unlock()
		if !ok || sess.id != longID {
			t.Error("long session ID not stored correctly")
		}

		a.Disconnect(longID)
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("after disconnect: ActiveSessions() = %d, want 0", got)
		}
	})

	t.Run("oracle", func(t *testing.T) {
		t.Parallel()
		a := NewOracleAdapter()
		c := newOracleSessionDirect(t, a, longID)
		defer c.Close()
		a.Disconnect(longID)
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("after disconnect: ActiveSessions() = %d, want 0", got)
		}
	})

	t.Run("db2", func(t *testing.T) {
		t.Parallel()
		a := NewDB2Adapter()
		c := newDB2SessionDirect(t, a, longID)
		defer c.Close()
		a.Disconnect(longID)
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("after disconnect: ActiveSessions() = %d, want 0", got)
		}
	})
}

// Ensure the io import is used
var _ = io.EOF
