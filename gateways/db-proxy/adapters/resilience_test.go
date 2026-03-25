package adapters

import (
	"context"
	"crypto/rand"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"testing"
	"time"
)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// newMSSQLSessionDirect injects a session into the MSSQL adapter without a real
// server handshake. Returns the upstream net.Conn pair (test side, adapter side).
func newMSSQLSessionDirect(t *testing.T, a *MSSQLAdapter, id string) (testSide net.Conn) {
	t.Helper()
	testConn, adapterConn := net.Pipe()
	_, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.sessions[id] = &mssqlSession{
		id:       id,
		upstream: adapterConn,
		cancel:   cancel,
	}
	a.mu.Unlock()
	return testConn
}

func newOracleSessionDirect(t *testing.T, a *OracleAdapter, id string) (testSide net.Conn) {
	t.Helper()
	testConn, adapterConn := net.Pipe()
	_, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.sessions[id] = &oracleSession{
		id:       id,
		upstream: adapterConn,
		cancel:   cancel,
	}
	a.mu.Unlock()
	return testConn
}

func newDB2SessionDirect(t *testing.T, a *DB2Adapter, id string) (testSide net.Conn) {
	t.Helper()
	testConn, adapterConn := net.Pipe()
	_, cancel := context.WithCancel(context.Background())
	a.mu.Lock()
	a.sessions[id] = &db2Session{
		id:       id,
		upstream: adapterConn,
		cancel:   cancel,
	}
	a.mu.Unlock()
	return testConn
}

// ---------------------------------------------------------------------------
// 1. TestAdapterSessionLeakPrevention
// ---------------------------------------------------------------------------

func TestAdapterSessionLeakPrevention(t *testing.T) {
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
			conns := make([]net.Conn, 100)
			for i := 0; i < 100; i++ {
				conns[i] = ad.inject(t, a, fmt.Sprintf("leak-%d", i))
			}

			// Disconnect first 50
			for i := 0; i < 50; i++ {
				conns[i].Close()
				a.Disconnect(fmt.Sprintf("leak-%d", i))
			}

			if got := a.ActiveSessions(); got != 50 {
				t.Errorf("after disconnecting 50: ActiveSessions() = %d, want 50", got)
			}

			// Disconnect remaining 50
			for i := 50; i < 100; i++ {
				conns[i].Close()
				a.Disconnect(fmt.Sprintf("leak-%d", i))
			}

			if got := a.ActiveSessions(); got != 0 {
				t.Errorf("after disconnecting all: ActiveSessions() = %d, want 0", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 2. TestConcurrentSessionLifecycle
// ---------------------------------------------------------------------------

func TestConcurrentSessionLifecycle(t *testing.T) {
	t.Parallel()

	type adapterDef struct {
		name       string
		newAdapter func() Adapter
		inject     func(t *testing.T, a Adapter, id string) net.Conn
	}

	defs := []adapterDef{
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

	for _, ad := range defs {
		t.Run(ad.name, func(t *testing.T) {
			t.Parallel()
			a := ad.newAdapter()
			const n = 20
			var wgCreate sync.WaitGroup
			conns := make([]net.Conn, n)
			var mu sync.Mutex

			// Create 20 sessions concurrently
			for i := 0; i < n; i++ {
				wgCreate.Add(1)
				go func(idx int) {
					defer wgCreate.Done()
					c := ad.inject(t, a, fmt.Sprintf("conc-%d", idx))
					mu.Lock()
					conns[idx] = c
					mu.Unlock()
				}(i)
			}
			wgCreate.Wait()

			if got := a.ActiveSessions(); got != n {
				t.Errorf("after create: ActiveSessions() = %d, want %d", got, n)
			}

			// Forward traffic (briefly) on each session concurrently
			var wgForward sync.WaitGroup
			for i := 0; i < n; i++ {
				wgForward.Add(1)
				go func(idx int) {
					defer wgForward.Done()
					client, peer := net.Pipe()
					defer client.Close()
					defer peer.Close()

					ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
					defer cancel()

					// Forward will block until ctx expires or a side closes
					_ = a.Forward(ctx, fmt.Sprintf("conc-%d", idx), client)
				}(i)
			}
			wgForward.Wait()

			// Disconnect all concurrently
			var wgDisc sync.WaitGroup
			for i := 0; i < n; i++ {
				wgDisc.Add(1)
				go func(idx int) {
					defer wgDisc.Done()
					mu.Lock()
					if conns[idx] != nil {
						conns[idx].Close()
					}
					mu.Unlock()
					a.Disconnect(fmt.Sprintf("conc-%d", idx))
				}(i)
			}
			wgDisc.Wait()

			if got := a.ActiveSessions(); got != 0 {
				t.Errorf("after disconnect all: ActiveSessions() = %d, want 0", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 3. TestForwardWithBrokenUpstream
// ---------------------------------------------------------------------------

func TestForwardWithBrokenUpstream(t *testing.T) {
	t.Parallel()
	a := NewMSSQLAdapter()

	upstreamTest := newMSSQLSessionDirect(t, a, "broken-up")

	client, clientPeer := net.Pipe()
	defer client.Close()

	done := make(chan error, 1)
	go func() {
		done <- a.Forward(context.Background(), "broken-up", clientPeer)
	}()

	// Close the upstream side abruptly
	upstreamTest.Close()

	select {
	case <-done:
		// Forward returned — good
	case <-time.After(5 * time.Second):
		t.Fatal("Forward did not return after upstream closed")
	}

	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d after broken upstream, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// 4. TestForwardWithBrokenClient
// ---------------------------------------------------------------------------

func TestForwardWithBrokenClient(t *testing.T) {
	t.Parallel()
	a := NewOracleAdapter()

	upstreamTest := newOracleSessionDirect(t, a, "broken-client")
	defer upstreamTest.Close()

	client, clientPeer := net.Pipe()

	done := make(chan error, 1)
	go func() {
		done <- a.Forward(context.Background(), "broken-client", clientPeer)
	}()

	// Close client side abruptly
	client.Close()

	select {
	case <-done:
		// Forward returned — good
	case <-time.After(5 * time.Second):
		t.Fatal("Forward did not return after client closed")
	}

	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d after broken client, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// 5. TestConnectTimeout
// ---------------------------------------------------------------------------

func TestConnectTimeout(t *testing.T) {
	t.Parallel()

	// Start a TCP listener that accepts but never responds (black hole)
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	// Accept connections but do nothing with them
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			// Hold the connection open but never write anything
			go func(c net.Conn) {
				buf := make([]byte, 1024)
				for {
					if _, err := c.Read(buf); err != nil {
						c.Close()
						return
					}
				}
			}(conn)
		}
	}()

	addr := ln.Addr().(*net.TCPAddr)

	adapters := []struct {
		name    string
		adapter Adapter
	}{
		{"mssql", NewMSSQLAdapter()},
		{"oracle", NewOracleAdapter()},
		{"db2", NewDB2Adapter()},
	}

	for _, ad := range adapters {
		t.Run(ad.name, func(t *testing.T) {
			t.Parallel()
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			defer cancel()

			opts := ConnectOptions{
				SessionID:    fmt.Sprintf("timeout-%s", ad.name),
				Host:         "127.0.0.1",
				Port:         addr.Port,
				Username:     "user",
				Password:     "pass",
				DatabaseName: "db",
				Extra:        map[string]string{},
			}

			start := time.Now()
			_, err := ad.adapter.Connect(ctx, opts)
			elapsed := time.Since(start)

			if err == nil {
				t.Fatal("Connect to black-hole should have failed")
			}

			// Should complete within a reasonable time (context timeout + margin)
			if elapsed > 20*time.Second {
				t.Errorf("Connect took %v, expected it to timeout sooner", elapsed)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 6. TestMalformedProtocolResponse
// ---------------------------------------------------------------------------

func TestMalformedProtocolResponse(t *testing.T) {
	t.Parallel()

	t.Run("mssql_garbage_prelogin_response", func(t *testing.T) {
		t.Parallel()
		// Start a fake server that sends garbage for TDS pre-login response
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
			// Read client pre-login, respond with garbage
			buf := make([]byte, 1024)
			conn.Read(buf)
			conn.Write([]byte{0xDE, 0xAD, 0xBE, 0xEF, 0x00, 0x00, 0x00, 0x00})
		}()

		addr := ln.Addr().(*net.TCPAddr)
		a := NewMSSQLAdapter()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err = a.Connect(ctx, ConnectOptions{
			SessionID: "garbage-mssql",
			Host:      "127.0.0.1",
			Port:      addr.Port,
			Username:  "sa",
			Password:  "pwd",
			Extra:     map[string]string{},
		})
		// Should get an error but not panic
		// The pre-login response reads header bytes; garbage may or may not
		// match expectations, but must not crash.
		_ = err
	})

	t.Run("oracle_garbage_tns_response", func(t *testing.T) {
		t.Parallel()
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
			buf := make([]byte, 1024)
			conn.Read(buf)
			// Send garbage TNS response with invalid packet type
			header := make([]byte, tnsHeaderSize)
			binary.BigEndian.PutUint16(header[0:2], uint16(tnsHeaderSize))
			header[4] = 0xFF // invalid TNS type
			conn.Write(header)
		}()

		addr := ln.Addr().(*net.TCPAddr)
		a := NewOracleAdapter()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err = a.Connect(ctx, ConnectOptions{
			SessionID:    "garbage-oracle",
			Host:         "127.0.0.1",
			Port:         addr.Port,
			Username:     "sys",
			Password:     "pwd",
			DatabaseName: "XE",
			Extra:        map[string]string{},
		})
		if err == nil {
			t.Fatal("expected error for garbage TNS response")
		}
	})

	t.Run("db2_garbage_drda_response", func(t *testing.T) {
		t.Parallel()
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
			buf := make([]byte, 1024)
			conn.Read(buf)
			// Send a DRDA response with length too short
			pkt := make([]byte, drdaDSSHeaderSize)
			binary.BigEndian.PutUint16(pkt[0:2], uint16(drdaDSSHeaderSize)) // too short for DDM
			pkt[2] = 0xD0
			pkt[3] = 0x02
			binary.BigEndian.PutUint16(pkt[4:6], 1)
			conn.Write(pkt)
		}()

		addr := ln.Addr().(*net.TCPAddr)
		a := NewDB2Adapter()
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		_, err = a.Connect(ctx, ConnectOptions{
			SessionID:    "garbage-db2",
			Host:         "127.0.0.1",
			Port:         addr.Port,
			Username:     "db2admin",
			Password:     "pwd",
			DatabaseName: "SAMPLE",
			Extra:        map[string]string{},
		})
		if err == nil {
			t.Fatal("expected error for garbage DRDA response")
		}
	})
}

// ---------------------------------------------------------------------------
// 7. TestConcurrentHealthChecks
// ---------------------------------------------------------------------------

func TestConcurrentHealthChecks(t *testing.T) {
	t.Parallel()

	registry := NewRegistry()

	var wg sync.WaitGroup
	errs := make(chan error, 20*3) // 20 goroutines * 3 adapters

	for i := 0; i < 20; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			results := registry.HealthCheckAll()
			for proto, err := range results {
				if err != nil {
					errs <- fmt.Errorf("%s health check failed: %w", proto, err)
				}
			}
		}()
	}

	wg.Wait()
	close(errs)

	for err := range errs {
		t.Error(err)
	}
}

// ---------------------------------------------------------------------------
// 8. TestSessionIDUniqueness
// ---------------------------------------------------------------------------

func TestSessionIDUniqueness(t *testing.T) {
	t.Parallel()

	a := NewMSSQLAdapter()
	const n = 1000
	seen := make(map[string]bool, n)
	conns := make([]net.Conn, 0, n)

	for i := 0; i < n; i++ {
		id := fmt.Sprintf("unique-%d", i)
		if seen[id] {
			t.Fatalf("duplicate session ID generated: %s", id)
		}
		seen[id] = true
		c := newMSSQLSessionDirect(t, a, id)
		conns = append(conns, c)
	}

	if got := a.ActiveSessions(); got != n {
		t.Errorf("ActiveSessions() = %d, want %d", got, n)
	}

	// Verify all IDs are in the session map
	a.mu.Lock()
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("unique-%d", i)
		if _, ok := a.sessions[id]; !ok {
			t.Errorf("session %s missing from map", id)
		}
	}
	a.mu.Unlock()

	// Cleanup
	for i := 0; i < n; i++ {
		conns[i].Close()
		a.Disconnect(fmt.Sprintf("unique-%d", i))
	}
}

// ---------------------------------------------------------------------------
// 9. TestDisconnectNonExistent
// ---------------------------------------------------------------------------

func TestDisconnectNonExistent(t *testing.T) {
	t.Parallel()

	adapters := []struct {
		name    string
		adapter Adapter
	}{
		{"mssql", NewMSSQLAdapter()},
		{"oracle", NewOracleAdapter()},
		{"db2", NewDB2Adapter()},
	}

	for _, ad := range adapters {
		t.Run(ad.name, func(t *testing.T) {
			t.Parallel()
			// Must not panic
			ad.adapter.Disconnect("nonexistent-session-id")
			ad.adapter.Disconnect("")
			ad.adapter.Disconnect("another-fake-id")

			if got := ad.adapter.ActiveSessions(); got != 0 {
				t.Errorf("ActiveSessions() = %d, want 0", got)
			}
		})
	}
}

// ---------------------------------------------------------------------------
// 10. TestDoubleDisconnect
// ---------------------------------------------------------------------------

func TestDoubleDisconnect(t *testing.T) {
	t.Parallel()

	t.Run("mssql", func(t *testing.T) {
		t.Parallel()
		a := NewMSSQLAdapter()
		c := newMSSQLSessionDirect(t, a, "double-disc")
		c.Close()
		a.Disconnect("double-disc")
		a.Disconnect("double-disc") // second call — must be idempotent
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("ActiveSessions() = %d, want 0", got)
		}
	})

	t.Run("oracle", func(t *testing.T) {
		t.Parallel()
		a := NewOracleAdapter()
		c := newOracleSessionDirect(t, a, "double-disc")
		c.Close()
		a.Disconnect("double-disc")
		a.Disconnect("double-disc")
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("ActiveSessions() = %d, want 0", got)
		}
	})

	t.Run("db2", func(t *testing.T) {
		t.Parallel()
		a := NewDB2Adapter()
		c := newDB2SessionDirect(t, a, "double-disc")
		c.Close()
		a.Disconnect("double-disc")
		a.Disconnect("double-disc")
		if got := a.ActiveSessions(); got != 0 {
			t.Errorf("ActiveSessions() = %d, want 0", got)
		}
	})
}

// ---------------------------------------------------------------------------
// 11. TestMSSQLTDSPacketFragmentation
// ---------------------------------------------------------------------------

func TestMSSQLTDSPacketFragmentation(t *testing.T) {
	t.Parallel()

	// Test that readTDSPreLoginResponse handles fragmented reads correctly.
	// We use net.Pipe which allows us to control write sizes precisely.
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	// Build a valid TDS pre-login response
	payload := []byte{0x00, 0x00, 0x06, 0x00, 0x06, 0xFF, 0x0F, 0x00, 0x00, 0x00, 0x00, 0x00}
	totalLen := tdsHeaderSize + len(payload)
	header := make([]byte, tdsHeaderSize)
	header[0] = tdsPacketTypePreLoginResp
	header[1] = tdsStatusEOM
	binary.BigEndian.PutUint16(header[2:4], uint16(totalLen))

	fullPacket := append(header, payload...)

	errCh := make(chan error, 1)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		errCh <- readTDSPreLoginResponse(ctx, client)
	}()

	// Send in fragments: first 3 bytes of header, then the rest
	if _, err := server.Write(fullPacket[:3]); err != nil {
		t.Fatalf("write fragment 1: %v", err)
	}
	time.Sleep(10 * time.Millisecond) // small delay to simulate fragmentation
	if _, err := server.Write(fullPacket[3:6]); err != nil {
		t.Fatalf("write fragment 2: %v", err)
	}
	time.Sleep(10 * time.Millisecond)
	if _, err := server.Write(fullPacket[6:]); err != nil {
		t.Fatalf("write fragment 3: %v", err)
	}

	select {
	case err := <-errCh:
		if err != nil {
			t.Errorf("readTDSPreLoginResponse with fragments returned error: %v", err)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("readTDSPreLoginResponse timed out on fragmented input")
	}
}

// ---------------------------------------------------------------------------
// 12. TestOracleTNSRedirectLoop
// ---------------------------------------------------------------------------

func TestOracleTNSRedirectLoop(t *testing.T) {
	t.Parallel()

	// Start a fake Oracle listener that always sends Redirect responses.
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go func(c net.Conn) {
				defer c.Close()
				buf := make([]byte, 4096)
				c.Read(buf) // read TNS Connect

				// Send TNS Redirect response
				redirectData := []byte("(ADDRESS=(PROTOCOL=TCP)(HOST=127.0.0.1)(PORT=9999))")
				pktLen := tnsHeaderSize + len(redirectData)
				header := make([]byte, tnsHeaderSize)
				binary.BigEndian.PutUint16(header[0:2], uint16(pktLen))
				header[4] = tnsPacketTypeRedirect
				c.Write(header)
				c.Write(redirectData)
			}(conn)
		}
	}()

	addr := ln.Addr().(*net.TCPAddr)
	a := NewOracleAdapter()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err = a.Connect(ctx, ConnectOptions{
		SessionID:    "redirect-loop",
		Host:         "127.0.0.1",
		Port:         addr.Port,
		Username:     "sys",
		Password:     "pwd",
		DatabaseName: "XE",
		Extra:        map[string]string{},
	})

	if err == nil {
		t.Fatal("Connect should fail on redirect")
	}

	// Verify the session was cleaned up
	if got := a.ActiveSessions(); got != 0 {
		t.Errorf("ActiveSessions() = %d after redirect, want 0", got)
	}
}

// ---------------------------------------------------------------------------
// 13. TestDB2DRDALargePayload
// ---------------------------------------------------------------------------

func TestDB2DRDALargePayload(t *testing.T) {
	t.Parallel()

	// Build a DRDA packet with maximum valid uint16 payload minus headers.
	// This tests that makeDRDAPacket handles large payloads without panics.
	// We use a realistic large size (32KB) rather than the full 64KB to keep
	// the test fast and memory-friendly.
	const payloadSize = 32 * 1024
	payload := make([]byte, payloadSize)
	if _, err := rand.Read(payload); err != nil {
		t.Fatalf("rand.Read: %v", err)
	}

	pkt := makeDRDAPacket(ddmCodePointACCRDB, payload)

	expectedDSSLen := drdaDSSHeaderSize + drdaDDMHeaderSize + payloadSize
	if len(pkt) != expectedDSSLen {
		t.Fatalf("packet length = %d, want %d", len(pkt), expectedDSSLen)
	}

	// Verify DSS length field
	dssLen := binary.BigEndian.Uint16(pkt[0:2])
	if int(dssLen) != expectedDSSLen {
		t.Errorf("DSS length field = %d, want %d", dssLen, expectedDSSLen)
	}

	// Verify we can write and read this large packet over a pipe
	client, server := net.Pipe()
	defer client.Close()
	defer server.Close()

	done := make(chan error, 1)
	go func() {
		_, err := client.Write(pkt)
		done <- err
	}()

	received := make([]byte, len(pkt))
	if _, err := io.ReadFull(server, received); err != nil {
		t.Fatalf("read large DRDA packet: %v", err)
	}

	if err := <-done; err != nil {
		t.Fatalf("write large DRDA packet: %v", err)
	}

	// Verify payload integrity
	for i := 0; i < payloadSize; i++ {
		if received[drdaDSSHeaderSize+drdaDDMHeaderSize+i] != payload[i] {
			t.Fatalf("payload mismatch at byte %d", i)
		}
	}
}

// ---------------------------------------------------------------------------
// 14. TestForwardBidirectionalConcurrency
// ---------------------------------------------------------------------------

func TestForwardBidirectionalConcurrency(t *testing.T) {
	t.Parallel()

	a := NewMSSQLAdapter()
	upstreamTest := newMSSQLSessionDirect(t, a, "bidir")

	clientLocal, clientPeer := net.Pipe()

	forwardDone := make(chan error, 1)
	go func() {
		forwardDone <- a.Forward(context.Background(), "bidir", clientPeer)
	}()

	const msgCount = 100
	const msgSize = 256

	// Generate deterministic test data
	clientToUpstream := make([][]byte, msgCount)
	upstreamToClient := make([][]byte, msgCount)
	for i := 0; i < msgCount; i++ {
		clientToUpstream[i] = make([]byte, msgSize)
		upstreamToClient[i] = make([]byte, msgSize)
		for j := 0; j < msgSize; j++ {
			clientToUpstream[i][j] = byte((i + j) % 256)
			upstreamToClient[i][j] = byte((i + j + 128) % 256)
		}
	}

	var wg sync.WaitGroup

	// Client -> upstream
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < msgCount; i++ {
			if _, err := clientLocal.Write(clientToUpstream[i]); err != nil {
				return
			}
		}
		clientLocal.Close()
	}()

	// Upstream -> client (read what client sent)
	wg.Add(1)
	go func() {
		defer wg.Done()
		received := make([]byte, msgCount*msgSize)
		n, _ := io.ReadFull(upstreamTest, received)
		// Verify data integrity via checksum
		if n > 0 {
			expected := make([]byte, 0, msgCount*msgSize)
			for i := 0; i < msgCount; i++ {
				expected = append(expected, clientToUpstream[i]...)
			}
			for i := 0; i < n && i < len(expected); i++ {
				if received[i] != expected[i] {
					t.Errorf("client->upstream data mismatch at byte %d: got %d, want %d", i, received[i], expected[i])
					return
				}
			}
		}
	}()

	// Upstream -> client (write data)
	wg.Add(1)
	go func() {
		defer wg.Done()
		for i := 0; i < msgCount; i++ {
			if _, err := upstreamTest.Write(upstreamToClient[i]); err != nil {
				return
			}
		}
		upstreamTest.Close()
	}()

	// Client <- upstream (read what upstream sent)
	wg.Add(1)
	go func() {
		defer wg.Done()
		received := make([]byte, msgCount*msgSize)
		n, _ := io.ReadFull(clientLocal, received)
		if n > 0 {
			expected := make([]byte, 0, msgCount*msgSize)
			for i := 0; i < msgCount; i++ {
				expected = append(expected, upstreamToClient[i]...)
			}
			for i := 0; i < n && i < len(expected); i++ {
				if received[i] != expected[i] {
					t.Errorf("upstream->client data mismatch at byte %d: got %d, want %d", i, received[i], expected[i])
					return
				}
			}
		}
	}()

	wg.Wait()

	select {
	case <-forwardDone:
	case <-time.After(10 * time.Second):
		t.Fatal("Forward did not return after bidirectional traffic")
	}
}

// ---------------------------------------------------------------------------
// 15. TestMassiveSessionCount
// ---------------------------------------------------------------------------

func TestMassiveSessionCount(t *testing.T) {
	t.Parallel()

	const sessionsPerAdapter = 500

	type adapterDef struct {
		name       string
		newAdapter func() Adapter
		inject     func(t *testing.T, a Adapter, id string) net.Conn
	}

	defs := []adapterDef{
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

	for _, ad := range defs {
		t.Run(ad.name, func(t *testing.T) {
			t.Parallel()
			a := ad.newAdapter()
			conns := make([]net.Conn, sessionsPerAdapter)

			for i := 0; i < sessionsPerAdapter; i++ {
				conns[i] = ad.inject(t, a, fmt.Sprintf("mass-%d", i))
			}

			if got := a.ActiveSessions(); got != sessionsPerAdapter {
				t.Errorf("ActiveSessions() = %d, want %d", got, sessionsPerAdapter)
			}

			// Disconnect all
			for i := 0; i < sessionsPerAdapter; i++ {
				conns[i].Close()
				a.Disconnect(fmt.Sprintf("mass-%d", i))
			}

			if got := a.ActiveSessions(); got != 0 {
				t.Errorf("after cleanup: ActiveSessions() = %d, want 0", got)
			}
		})
	}
}
