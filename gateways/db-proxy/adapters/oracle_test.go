package adapters

import (
	"context"
	"encoding/binary"
	"net"
	"strings"
	"testing"
)

func TestOracleAdapter_Protocol(t *testing.T) {
	a := NewOracleAdapter()
	if got := a.Protocol(); got != "oracle" {
		t.Errorf("Protocol() = %q, want %q", got, "oracle")
	}
}

func TestOracleAdapter_DefaultPort(t *testing.T) {
	a := NewOracleAdapter()
	if got := a.DefaultPort(); got != 1521 {
		t.Errorf("DefaultPort() = %d, want %d", got, 1521)
	}
}

func TestOracleAdapter_HealthCheck(t *testing.T) {
	a := NewOracleAdapter()
	if err := a.HealthCheck(); err != nil {
		t.Errorf("HealthCheck() = %v, want nil", err)
	}
}

func TestOracleAdapter_ActiveSessions_Empty(t *testing.T) {
	a := NewOracleAdapter()
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d, want 0", got)
	}
}

func TestOracleAdapter_Disconnect_NonExistent(t *testing.T) {
	a := NewOracleAdapter()
	a.Disconnect("non-existent")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() after Disconnect = %d, want 0", got)
	}
}

func TestOracleAdapter_Forward_NonExistentSession(t *testing.T) {
	a := NewOracleAdapter()
	err := a.Forward(nil, "non-existent", nil)
	if err == nil {
		t.Fatal("Forward() with non-existent session should return error")
	}
}

func TestTNSConstants(t *testing.T) {
	tests := []struct {
		name     string
		got      int
		expected int
	}{
		{"tnsPacketTypeConnect", tnsPacketTypeConnect, 1},
		{"tnsPacketTypeAccept", tnsPacketTypeAccept, 2},
		{"tnsPacketTypeRefuse", tnsPacketTypeRefuse, 4},
		{"tnsPacketTypeData", tnsPacketTypeData, 6},
		{"tnsPacketTypeResend", tnsPacketTypeResend, 11},
		{"tnsPacketTypeMarker", tnsPacketTypeMarker, 12},
		{"tnsPacketTypeRedirect", tnsPacketTypeRedirect, 5},
		{"tnsHeaderSize", tnsHeaderSize, 8},
		{"oracleDefaultPort", oracleDefaultPort, 1521},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if tt.got != tt.expected {
				t.Errorf("%s = %d, want %d", tt.name, tt.got, tt.expected)
			}
		})
	}
}

// --- TNS Connect Descriptor tests ---

func TestBuildTNSConnectDescriptor_WithSID(t *testing.T) {
	opts := ConnectOptions{
		Host: "db-host",
		Port: 1521,
		Extra: map[string]string{
			"sid": "ORCL",
		},
	}

	desc := buildTNSConnectDescriptor(opts)

	if !strings.Contains(desc, "(SID=ORCL)") {
		t.Errorf("descriptor should contain SID clause, got: %s", desc)
	}
	if strings.Contains(desc, "SERVICE_NAME") {
		t.Errorf("descriptor should NOT contain SERVICE_NAME when SID is set, got: %s", desc)
	}
	if !strings.Contains(desc, "(HOST=db-host)") {
		t.Errorf("descriptor should contain HOST, got: %s", desc)
	}
	if !strings.Contains(desc, "(PORT=1521)") {
		t.Errorf("descriptor should contain PORT, got: %s", desc)
	}
	if !strings.Contains(desc, "(PROTOCOL=TCP)") {
		t.Errorf("descriptor should contain PROTOCOL=TCP, got: %s", desc)
	}
}

func TestBuildTNSConnectDescriptor_WithServiceName(t *testing.T) {
	opts := ConnectOptions{
		Host: "oracle-server",
		Port: 1522,
		Extra: map[string]string{
			"serviceName": "myservice.example.com",
		},
	}

	desc := buildTNSConnectDescriptor(opts)

	if !strings.Contains(desc, "(SERVICE_NAME=myservice.example.com)") {
		t.Errorf("descriptor should contain SERVICE_NAME, got: %s", desc)
	}
	if strings.Contains(desc, "(SID=") {
		t.Errorf("descriptor should NOT contain SID when serviceName is set, got: %s", desc)
	}
}

func TestBuildTNSConnectDescriptor_FallbackToDatabaseName(t *testing.T) {
	opts := ConnectOptions{
		Host:         "oracle-server",
		Port:         1521,
		DatabaseName: "mydb",
		Extra:        map[string]string{},
	}

	desc := buildTNSConnectDescriptor(opts)

	if !strings.Contains(desc, "(SERVICE_NAME=mydb)") {
		t.Errorf("descriptor should use DatabaseName as SERVICE_NAME fallback, got: %s", desc)
	}
}

func TestBuildTNSConnectDescriptor_SIDPrecedenceOverServiceName(t *testing.T) {
	opts := ConnectOptions{
		Host: "host",
		Port: 1521,
		Extra: map[string]string{
			"sid":         "MYSID",
			"serviceName": "myservice",
		},
	}

	desc := buildTNSConnectDescriptor(opts)

	if !strings.Contains(desc, "(SID=MYSID)") {
		t.Errorf("SID should take precedence, got: %s", desc)
	}
	if strings.Contains(desc, "SERVICE_NAME") {
		t.Errorf("SERVICE_NAME should not appear when SID is set, got: %s", desc)
	}
}

func TestBuildTNSConnectDescriptor_NoServiceIdentifier(t *testing.T) {
	opts := ConnectOptions{
		Host:  "host",
		Port:  1521,
		Extra: map[string]string{},
	}

	desc := buildTNSConnectDescriptor(opts)

	// Should still produce a valid descriptor, just with empty CONNECT_DATA
	if !strings.Contains(desc, "CONNECT_DATA") {
		t.Errorf("descriptor should contain CONNECT_DATA, got: %s", desc)
	}
	if !strings.Contains(desc, "DESCRIPTION") {
		t.Errorf("descriptor should contain DESCRIPTION, got: %s", desc)
	}
}

func TestBuildTNSConnectDescriptor_Format(t *testing.T) {
	opts := ConnectOptions{
		Host: "10.0.0.1",
		Port: 1521,
		Extra: map[string]string{
			"sid": "XE",
		},
	}

	desc := buildTNSConnectDescriptor(opts)
	expected := "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=10.0.0.1)(PORT=1521))(CONNECT_DATA=(SID=XE)))"

	if desc != expected {
		t.Errorf("descriptor =\n  %s\nwant:\n  %s", desc, expected)
	}
}

// --- TNS header encoding test via sendTNSConnect ---

func TestSendTNSConnect_HeaderEncoding(t *testing.T) {
	// Use a pipe to capture what sendTNSConnect writes
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	connectDesc := "(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=localhost)(PORT=1521))(CONNECT_DATA=(SID=XE)))"

	errCh := make(chan error, 1)
	go func() {
		errCh <- sendTNSConnect(client, connectDesc)
	}()

	// Read the TNS header (8 bytes)
	header := make([]byte, tnsHeaderSize)
	if _, err := server.Read(header); err != nil {
		t.Fatalf("read header: %v", err)
	}

	// Packet length in bytes 0-1 (big-endian)
	pktLen := binary.BigEndian.Uint16(header[0:2])
	expectedLen := uint16(tnsHeaderSize + len(connectDesc))
	if pktLen != expectedLen {
		t.Errorf("packet length = %d, want %d", pktLen, expectedLen)
	}

	// Packet type at byte 4
	if header[4] != tnsPacketTypeConnect {
		t.Errorf("packet type = %d, want %d (Connect)", header[4], tnsPacketTypeConnect)
	}

	// Read the descriptor payload
	payload := make([]byte, len(connectDesc))
	if _, err := server.Read(payload); err != nil {
		t.Fatalf("read payload: %v", err)
	}

	if string(payload) != connectDesc {
		t.Errorf("payload = %q, want %q", string(payload), connectDesc)
	}

	if err := <-errCh; err != nil {
		t.Errorf("sendTNSConnect returned error: %v", err)
	}
}

// --- Session management tests ---

func TestOracleAdapter_SessionLifecycle(t *testing.T) {
	a := NewOracleAdapter()

	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())

	a.mu.Lock()
	a.sessions["sess-1"] = &oracleSession{id: "sess-1", cancel: cancel1}
	a.sessions["sess-2"] = &oracleSession{id: "sess-2", cancel: cancel2}
	a.mu.Unlock()

	if got := a.ActiveSessions(); got != 2 {
		t.Errorf("ActiveSessions() = %d, want 2", got)
	}

	a.removeSession("sess-1")
	if got := a.ActiveSessions(); got != 1 {
		t.Errorf("after remove: ActiveSessions() = %d, want 1", got)
	}

	a.removeSession("sess-2")
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("after remove all: ActiveSessions() = %d, want 0", got)
	}
}

func TestOracleAdapter_RemoveSession_Idempotent(t *testing.T) {
	a := NewOracleAdapter()
	a.removeSession("does-not-exist")
	a.removeSession("does-not-exist")
}

// --- WaitTNSResponse tests via pipe ---

func TestWaitTNSResponse_Accept(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	// Write an Accept response from "server" side
	go func() {
		header := make([]byte, tnsHeaderSize)
		binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize)) // length = header only
		header[4] = tnsPacketTypeAccept
		server.Write(header)
	}()

	ctx := t.Context()
	err := waitTNSResponse(ctx, client)
	if err != nil {
		t.Errorf("waitTNSResponse(Accept) = %v, want nil", err)
	}
}

func TestWaitTNSResponse_Refuse(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	go func() {
		header := make([]byte, tnsHeaderSize)
		binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize))
		header[4] = tnsPacketTypeRefuse
		server.Write(header)
	}()

	ctx := t.Context()
	err := waitTNSResponse(ctx, client)
	if err == nil {
		t.Fatal("waitTNSResponse(Refuse) should return error")
	}
	if !strings.Contains(err.Error(), "refused") {
		t.Errorf("error should mention 'refused', got: %v", err)
	}
}

func TestWaitTNSResponse_Redirect(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	go func() {
		header := make([]byte, tnsHeaderSize)
		binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize))
		header[4] = tnsPacketTypeRedirect
		server.Write(header)
	}()

	ctx := t.Context()
	err := waitTNSResponse(ctx, client)
	if err == nil {
		t.Fatal("waitTNSResponse(Redirect) should return error")
	}
	if !strings.Contains(err.Error(), "redirect") {
		t.Errorf("error should mention 'redirect', got: %v", err)
	}
}

func TestWaitTNSResponse_UnexpectedType(t *testing.T) {
	client, server := createPipe(t)
	defer client.Close()
	defer server.Close()

	go func() {
		header := make([]byte, tnsHeaderSize)
		binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize))
		header[4] = 99 // unexpected type
		server.Write(header)
	}()

	ctx := t.Context()
	err := waitTNSResponse(ctx, client)
	if err == nil {
		t.Fatal("waitTNSResponse(unexpected) should return error")
	}
	if !strings.Contains(err.Error(), "unexpected") {
		t.Errorf("error should mention 'unexpected', got: %v", err)
	}
}

// createPipe creates a pair of connected net.Conn for testing.
func createPipe(t *testing.T) (net.Conn, net.Conn) {
	t.Helper()
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}

	connCh := make(chan net.Conn, 1)
	go func() {
		c, err := ln.Accept()
		if err == nil {
			connCh <- c
		}
	}()

	client, err := net.Dial("tcp", ln.Addr().String())
	if err != nil {
		ln.Close()
		t.Fatalf("dial: %v", err)
	}

	server := <-connCh
	ln.Close()
	return client, server
}
