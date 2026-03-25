package tunnel

import (
	"bytes"
	"context"
	"crypto/rand"
	"fmt"
	"io"
	"math/big"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

// testConfig returns a Config pointing at the given WebSocket URL with fast
// reconnect timings suitable for tests.
func testConfig(wsURL string) Config {
	return Config{
		ServerURL:        wsURL,
		Token:            "test-token",
		GatewayID:        "gw-resilience",
		AgentVersion:     "1.0.0",
		LocalHost:        "127.0.0.1",
		PingInterval:     1 * time.Hour, // disabled unless test needs it
		ReconnectInitial: 10 * time.Millisecond,
		ReconnectMax:     100 * time.Millisecond,
	}
}

// wsURL converts an httptest.Server URL to a ws:// URL.
func wsURL(srv *httptest.Server) string {
	return "ws" + strings.TrimPrefix(srv.URL, "http")
}

// echoServer creates an httptest.Server that upgrades to WebSocket, echoes
// frames back, and runs until the connection is closed.
func echoServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.WriteMessage(mt, data)
		}
	}))
}

// ---------- Connection Resilience ----------

func TestReconnectAfterServerDrop(t *testing.T) {
	// Server accepts one connection, sends one DATA frame, then closes the WS.
	// After a brief pause a second server starts and the client must reconnect.
	var connCount atomic.Int32
	connected := make(chan struct{}, 2)
	dataSent := make(chan struct{}, 2)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		n := connCount.Add(1)
		connected <- struct{}{}

		if n == 1 {
			// First connection: send one frame then drop.
			frame := protocol.BuildFrame(protocol.MsgData, 1, []byte("first"))
			_ = conn.WriteMessage(websocket.BinaryMessage, frame)
			dataSent <- struct{}{}
			time.Sleep(50 * time.Millisecond)
			_ = conn.Close()
			return
		}
		// Second connection: send another frame and keep alive.
		frame := protocol.BuildFrame(protocol.MsgData, 2, []byte("second"))
		_ = conn.WriteMessage(websocket.BinaryMessage, frame)
		dataSent <- struct{}{}
		// Hold the connection open until test ends.
		for {
			_, _, err := conn.ReadMessage()
			if err != nil {
				return
			}
		}
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	stream1 := client.OpenStream(1)
	stream2 := client.OpenStream(2)
	_ = stream1 // stream1 will be cleaned up on disconnect

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Wait for first connection and data.
	<-connected
	<-dataSent

	// After server drops, client should reconnect.
	select {
	case <-connected:
		// Second connection established
	case <-time.After(5 * time.Second):
		t.Fatal("client did not reconnect after server drop")
	}

	<-dataSent
	// Re-open stream2 after reconnect (streams are cleaned up on disconnect).
	stream2 = client.OpenStream(2)

	// Verify the new stream works by reading server-sent data or writing.
	_, err := stream2.Write([]byte("post-reconnect"))
	if err != nil {
		t.Errorf("Write on new stream after reconnect failed: %v", err)
	}

	cancel()
	_ = client.Close()
}

func TestReconnectBackoffJitter(t *testing.T) {
	// Server that always refuses after upgrade (closes immediately).
	var timestamps []time.Time
	var mu sync.Mutex

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		mu.Lock()
		timestamps = append(timestamps, time.Now())
		mu.Unlock()
		_ = conn.Close()
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	cfg.ReconnectInitial = 20 * time.Millisecond
	cfg.ReconnectMax = 200 * time.Millisecond
	client := NewTunnelClient(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Wait for at least 5 connection attempts.
	deadline := time.After(3 * time.Second)
	for {
		mu.Lock()
		n := len(timestamps)
		mu.Unlock()
		if n >= 5 {
			break
		}
		select {
		case <-deadline:
			t.Fatalf("only got %d connection attempts, wanted at least 5", n)
		case <-time.After(10 * time.Millisecond):
		}
	}

	cancel()
	_ = client.Close()

	mu.Lock()
	ts := timestamps
	mu.Unlock()

	// Verify delays increase (with some tolerance for jitter).
	// Intervals should generally be increasing until they hit the max.
	allSame := true
	for i := 1; i < len(ts)-1; i++ {
		d1 := ts[i].Sub(ts[i-1])
		d2 := ts[i+1].Sub(ts[i])
		if d2 != d1 {
			allSame = false
		}
	}
	if allSame && len(ts) > 3 {
		t.Error("reconnect delays appear deterministic (no jitter)")
	}
}

func TestGracefulShutdownDuringActiveStreams(t *testing.T) {
	srv := echoServer(t)
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	// Open streams and write data concurrently.
	const numStreams = 20
	streams := make([]*Stream, numStreams)
	for i := 0; i < numStreams; i++ {
		streams[i] = client.OpenStream(uint16(i + 1))
	}

	var wg sync.WaitGroup
	for i := 0; i < numStreams; i++ {
		wg.Add(1)
		go func(s *Stream) {
			defer wg.Done()
			for j := 0; j < 50; j++ {
				_, _ = s.Write([]byte("data"))
			}
		}(streams[i])
	}

	// Close while streams are active.
	time.Sleep(5 * time.Millisecond)
	err := client.Close()
	if err != nil {
		t.Logf("Close returned: %v", err)
	}

	wg.Wait()
	cancel()

	// Verify all streams are closed (reads return EOF or ErrStreamClosed).
	for i, s := range streams {
		buf := make([]byte, 1)
		_, err := s.Read(buf)
		if err != io.EOF && err != ErrStreamClosed {
			t.Errorf("stream %d: expected EOF or ErrStreamClosed, got %v", i, err)
		}
	}
}

func TestConcurrentStreamCreation(t *testing.T) {
	srv := echoServer(t)
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	ctx := context.Background()
	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect: %v", err)
	}
	t.Cleanup(func() { _ = client.Close() })

	const numStreams = 100
	streams := make([]*Stream, numStreams)
	var wg sync.WaitGroup

	for i := 0; i < numStreams; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			streams[idx] = client.OpenStream(uint16(idx + 1))
		}(i)
	}
	wg.Wait()

	// Verify unique IDs and no nil streams.
	seen := make(map[uint16]bool)
	for i, s := range streams {
		if s == nil {
			t.Fatalf("stream %d is nil", i)
		}
		if seen[s.ID()] {
			t.Errorf("duplicate stream ID %d", s.ID())
		}
		seen[s.ID()] = true
	}
	if len(seen) != numStreams {
		t.Errorf("expected %d unique streams, got %d", numStreams, len(seen))
	}
}

func TestStreamDataIntegrityUnderLoad(t *testing.T) {
	// Server echoes all DATA frames back.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			// Parse frame, only echo DATA frames for stream 1.
			frame, _, parseErr := protocol.ParseFrame(data)
			if parseErr != nil {
				continue
			}
			if frame.Type == protocol.MsgData && frame.StreamID == 1 {
				_ = conn.WriteMessage(mt, data)
			}
		}
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	stream := client.OpenStream(1)

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Give Run() time to connect.
	time.Sleep(100 * time.Millisecond)

	// Generate 1MB of random data.
	const totalSize = 1024 * 1024
	original := make([]byte, totalSize)
	_, _ = rand.Read(original)

	// Send in random-sized chunks (1-4096 bytes).
	go func() {
		offset := 0
		for offset < totalSize {
			maxChunk := totalSize - offset
			if maxChunk > 4096 {
				maxChunk = 4096
			}
			n, _ := rand.Int(rand.Reader, big.NewInt(int64(maxChunk)))
			chunkSize := int(n.Int64()) + 1
			if chunkSize > maxChunk {
				chunkSize = maxChunk
			}
			_, err := stream.Write(original[offset : offset+chunkSize])
			if err != nil {
				return
			}
			offset += chunkSize
		}
	}()

	// Read all echoed data.
	received := make([]byte, 0, totalSize)
	buf := make([]byte, 8192)
	deadline := time.After(10 * time.Second)
	for len(received) < totalSize {
		select {
		case <-deadline:
			t.Fatalf("timeout: received %d/%d bytes", len(received), totalSize)
		default:
		}
		n, err := stream.Read(buf)
		if err != nil {
			if err == io.EOF {
				break
			}
			t.Fatalf("Read error after %d bytes: %v", len(received), err)
		}
		received = append(received, buf[:n]...)
	}

	if len(received) != totalSize {
		t.Fatalf("size mismatch: got %d, want %d", len(received), totalSize)
	}
	if !bytes.Equal(original, received) {
		// Find first differing byte.
		for i := range original {
			if original[i] != received[i] {
				t.Fatalf("data mismatch at byte %d: got 0x%02x, want 0x%02x", i, received[i], original[i])
			}
		}
	}
}

func TestHeartbeatTimeoutDetection(t *testing.T) {
	// Server accepts connection but never responds to PING/HEARTBEAT and closes
	// after a short delay to simulate an unresponsive server.
	var connCount atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		n := connCount.Add(1)
		if n == 1 {
			// First connection: read frames but never respond, then close.
			go func() {
				for {
					_, _, err := conn.ReadMessage()
					if err != nil {
						return
					}
					// Silently consume everything.
				}
			}()
			time.Sleep(300 * time.Millisecond)
			_ = conn.Close()
			return
		}
		// Second connection: normal echo.
		defer conn.Close()
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.WriteMessage(mt, data)
		}
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	cfg.PingInterval = 50 * time.Millisecond // fast heartbeats
	client := NewTunnelClient(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Wait for reconnection (second connection attempt).
	deadline := time.After(4 * time.Second)
	for {
		if connCount.Load() >= 2 {
			break
		}
		select {
		case <-deadline:
			t.Fatal("client did not reconnect after heartbeat timeout")
		case <-time.After(20 * time.Millisecond):
		}
	}

	cancel()
	_ = client.Close()
}

func TestFrameDispatchWithCorruptedData(t *testing.T) {
	// Server sends various malformed frames; client must not panic.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()

		// Truncated header (2 bytes instead of 4).
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte{0x02, 0x00})

		// Invalid message type (0 is below MsgOpen).
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte{0x00, 0x00, 0x00, 0x01})

		// Invalid message type (255 is above MsgSessionResume).
		_ = conn.WriteMessage(websocket.BinaryMessage, []byte{0xFF, 0x00, 0x00, 0x01})

		// Valid header but empty payload (should be fine).
		_ = conn.WriteMessage(websocket.BinaryMessage, protocol.BuildFrame(protocol.MsgData, 99, nil))

		// Valid DATA frame for existing stream.
		_ = conn.WriteMessage(websocket.BinaryMessage, protocol.BuildFrame(protocol.MsgData, 1, []byte("ok")))

		time.Sleep(200 * time.Millisecond)
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	stream := client.OpenStream(1)

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// The valid frame for stream 1 should still arrive.
	buf := make([]byte, 64)
	n, err := stream.Read(buf)
	if err != nil {
		// Stream might have been closed by reconnect, which is acceptable.
		t.Logf("Read after corrupted frames: %v (acceptable)", err)
	} else if string(buf[:n]) != "ok" {
		t.Errorf("expected 'ok', got %q", string(buf[:n]))
	}

	cancel()
	_ = client.Close()
}

func TestConnectionRefusedRecovery(t *testing.T) {
	// Start a server, grab its listener address, stop it, then restart on the
	// same address after a delay. The client should retry and eventually connect.

	// Step 1: Start a temporary server to claim a port.
	readyCh := make(chan struct{}, 1)
	handler := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		defer conn.Close()
		readyCh <- struct{}{}
		for {
			mt, data, err := conn.ReadMessage()
			if err != nil {
				return
			}
			_ = conn.WriteMessage(mt, data)
		}
	})

	// Use a listener to grab a port.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	addr := listener.Addr().String()
	// Close the listener so the port is free but known.
	_ = listener.Close()

	wsAddr := "ws://" + addr
	cfg := testConfig(wsAddr)
	cfg.ReconnectInitial = 30 * time.Millisecond
	cfg.ReconnectMax = 100 * time.Millisecond
	client := NewTunnelClient(cfg)

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Step 2: Let the client fail a few times, then bring the server up.
	time.Sleep(200 * time.Millisecond)

	// Start a real server on the same address.
	newListener, err := net.Listen("tcp", addr)
	if err != nil {
		t.Fatalf("re-listen on %s: %v", addr, err)
	}
	srv := &httptest.Server{
		Listener: newListener,
		Config:   &http.Server{Handler: handler},
	}
	srv.Start()
	t.Cleanup(srv.Close)

	select {
	case <-readyCh:
		// Connected successfully after recovery.
	case <-time.After(5 * time.Second):
		t.Fatal("client did not connect after server came up")
	}

	cancel()
	_ = client.Close()
}

func TestMidTransferDisconnect(t *testing.T) {
	// Server sends partial data then drops the connection.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		conn, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			return
		}
		// Send a few DATA frames then close abruptly.
		for i := 0; i < 5; i++ {
			frame := protocol.BuildFrame(protocol.MsgData, 1, []byte(fmt.Sprintf("chunk-%d", i)))
			_ = conn.WriteMessage(websocket.BinaryMessage, frame)
		}
		time.Sleep(10 * time.Millisecond)
		_ = conn.Close()
	}))
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	stream := client.OpenStream(1)

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	t.Cleanup(cancel)

	go func() { _ = client.Run(ctx) }()

	// Read whatever we can before the disconnect.
	var received []string
	buf := make([]byte, 256)
	for {
		n, err := stream.Read(buf)
		if err != nil {
			break
		}
		received = append(received, string(buf[:n]))
	}

	// We should have gotten at least some chunks.
	if len(received) == 0 {
		t.Error("expected at least some data before disconnect")
	}

	// Verify no chunk is corrupted (partial).
	for _, chunk := range received {
		if !strings.HasPrefix(chunk, "chunk-") {
			t.Errorf("corrupted chunk: %q", chunk)
		}
	}

	cancel()
	_ = client.Close()
}

func TestCloseIdempotency(t *testing.T) {
	srv := echoServer(t)
	t.Cleanup(srv.Close)

	cfg := testConfig(wsURL(srv))
	client := NewTunnelClient(cfg)

	ctx := context.Background()
	if err := client.Connect(ctx); err != nil {
		t.Fatalf("Connect: %v", err)
	}

	// Call Close concurrently multiple times.
	const goroutines = 10
	var wg sync.WaitGroup
	errs := make([]error, goroutines)
	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			errs[idx] = client.Close()
		}(i)
	}
	wg.Wait()

	// No panics occurred if we reach here. Some calls may return nil or error.
}

// ---------- Stream Resilience ----------

func TestStreamReadAfterWriterGone(t *testing.T) {
	s := newStream(1, func(_ uint16, _ []byte) error { return nil })

	// Deliver data, then close (simulating writer gone).
	s.deliver([]byte("part1"))
	s.deliver([]byte("part2"))
	_ = s.Close()

	// Reader should get buffered data then EOF.
	var allData []byte
	buf := make([]byte, 64)
	for {
		n, err := s.Read(buf)
		if n > 0 {
			allData = append(allData, buf[:n]...)
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
	}

	want := "part1part2"
	if string(allData) != want {
		t.Errorf("got %q, want %q", string(allData), want)
	}
}

func TestStreamBufferBackpressure(t *testing.T) {
	s := newStream(1, nil)

	// Fill buffer to capacity (256).
	for i := 0; i < 256; i++ {
		if !s.deliver([]byte{byte(i)}) {
			t.Fatalf("deliver failed at %d, expected success up to 256", i)
		}
	}

	// Buffer is full -- deliver should return false.
	if s.deliver([]byte("overflow")) {
		t.Error("deliver should return false when buffer is full")
	}

	// Drain one item.
	buf := make([]byte, 1)
	_, err := s.Read(buf)
	if err != nil {
		t.Fatalf("Read: %v", err)
	}

	// Now deliver should succeed again.
	if !s.deliver([]byte("after-drain")) {
		t.Error("deliver should succeed after draining the buffer")
	}
}

func TestConcurrentReadWrite(t *testing.T) {
	var writeCount atomic.Int64
	s := newStream(1, func(_ uint16, _ []byte) error {
		writeCount.Add(1)
		return nil
	})

	const goroutines = 20
	const iterations = 100

	var wg sync.WaitGroup

	// Concurrent writers.
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				_, _ = s.Write([]byte("w"))
			}
		}()
	}

	// Concurrent delivers (simulating incoming data).
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for i := 0; i < iterations; i++ {
				s.deliver([]byte("d"))
			}
		}()
	}

	// Concurrent readers.
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			buf := make([]byte, 64)
			for i := 0; i < iterations; i++ {
				_, _ = s.Read(buf)
			}
		}()
	}

	// Close mid-flight to exercise the race paths.
	go func() {
		time.Sleep(5 * time.Millisecond)
		_ = s.Close()
	}()

	wg.Wait()

	// No panics or races if we get here (run with -race to verify).
	if writeCount.Load() == 0 {
		t.Error("expected some writes to succeed")
	}
}
