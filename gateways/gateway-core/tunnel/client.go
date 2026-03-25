package tunnel

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"math/rand"
	"net"
	"sync"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/auth"
	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

// FrameHandler is called for each incoming frame that is not handled internally
// (i.e., not OPEN/DATA/CLOSE/PING/PONG). Use it to hook session-layer frames.
type FrameHandler func(frame *protocol.Frame)

// TunnelClient manages the persistent WSS connection to the TunnelBroker,
// with reconnection, heartbeat, and stream multiplexing.
type TunnelClient struct {
	cfg            Config
	conn           *websocket.Conn
	connMu         sync.Mutex
	streams        map[uint16]*Stream
	streamsMu      sync.RWMutex
	frameHandler   FrameHandler
	reconnectDelay time.Duration
	stopped        bool
	stopMu         sync.Mutex
	stopCh         chan struct{}
}

// NewTunnelClient creates a new tunnel client with the given configuration.
func NewTunnelClient(cfg Config) *TunnelClient {
	return &TunnelClient{
		cfg:            cfg,
		streams:        make(map[uint16]*Stream),
		reconnectDelay: cfg.ReconnectInitial,
		stopCh:         make(chan struct{}),
	}
}

// SetFrameHandler sets a callback for frames not handled by the tunnel client
// internally (session-layer frames 8-15 and others). Must be called before Run.
func (tc *TunnelClient) SetFrameHandler(handler FrameHandler) {
	tc.frameHandler = handler
}

// Connect establishes the WebSocket connection to the TunnelBroker with
// authentication headers and optional mTLS.
func (tc *TunnelClient) Connect(ctx context.Context) error {
	tc.connMu.Lock()
	defer tc.connMu.Unlock()

	headers := auth.BuildAuthHeaders(tc.cfg.Token, tc.cfg.GatewayID, tc.cfg.AgentVersion)

	dialer := websocket.Dialer{
		HandshakeTimeout: 10 * time.Second,
	}

	// Configure mTLS if certificates are provided.
	if tc.cfg.CACert != "" || (tc.cfg.ClientCert != "" && tc.cfg.ClientKey != "") {
		tlsCfg, err := auth.BuildTLSConfig(tc.cfg.CACert, tc.cfg.ClientCert, tc.cfg.ClientKey)
		if err != nil {
			return fmt.Errorf("building TLS config: %w", err)
		}
		dialer.TLSClientConfig = tlsCfg
	}

	conn, _, err := dialer.DialContext(ctx, tc.cfg.ServerURL, headers)
	if err != nil {
		return fmt.Errorf("connecting to %s: %w", tc.cfg.ServerURL, err)
	}

	tc.conn = conn
	tc.reconnectDelay = tc.cfg.ReconnectInitial // reset backoff on success
	log.Printf("[tunnel] Connected to %s (gateway=%s)", tc.cfg.ServerURL, tc.cfg.GatewayID)
	return nil
}

// Run starts the main event loop: reads frames, dispatches to handlers, and
// reconnects on failure. It blocks until ctx is cancelled.
func (tc *TunnelClient) Run(ctx context.Context) error {
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tc.stopCh:
			return nil
		default:
		}

		if err := tc.Connect(ctx); err != nil {
			log.Printf("[tunnel] Connection failed: %v — retrying in %v", err, tc.reconnectDelay)
			if !tc.waitReconnect(ctx) {
				return ctx.Err()
			}
			continue
		}

		// Start heartbeat
		pingCtx, pingCancel := context.WithCancel(ctx)
		go tc.heartbeatLoop(pingCtx)

		// Read loop
		tc.readLoop(ctx)
		pingCancel()

		// Close the old connection to prevent WebSocket leak before reconnecting.
		tc.connMu.Lock()
		if tc.conn != nil {
			_ = tc.conn.Close()
			tc.conn = nil
		}
		tc.connMu.Unlock()

		// Connection lost — clean up streams
		tc.closeAllStreams()

		select {
		case <-tc.stopCh:
			return nil
		default:
		}

		log.Printf("[tunnel] Disconnected — reconnecting in %v", tc.reconnectDelay)
		if !tc.waitReconnect(ctx) {
			return ctx.Err()
		}
	}
}

// SendFrame sends a pre-built frame over the tunnel. It is safe for
// concurrent use.
func (tc *TunnelClient) SendFrame(frame *protocol.Frame) error {
	data := protocol.BuildFrame(frame.Type, frame.StreamID, frame.Payload)
	tc.connMu.Lock()
	defer tc.connMu.Unlock()
	if tc.conn == nil {
		return fmt.Errorf("not connected")
	}
	return tc.conn.WriteMessage(websocket.BinaryMessage, data)
}

// Close gracefully shuts down the tunnel client.
func (tc *TunnelClient) Close() error {
	tc.stopMu.Lock()
	if !tc.stopped {
		tc.stopped = true
		close(tc.stopCh)
	}
	tc.stopMu.Unlock()

	tc.closeAllStreams()

	tc.connMu.Lock()
	defer tc.connMu.Unlock()
	if tc.conn != nil {
		err := tc.conn.WriteMessage(
			websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseNormalClosure, "agent shutdown"),
		)
		_ = tc.conn.Close()
		tc.conn = nil
		return err
	}
	return nil
}

// OpenStream registers a new stream for the given ID. The caller is
// responsible for sending the OPEN frame.
func (tc *TunnelClient) OpenStream(streamID uint16) *Stream {
	s := newStream(streamID, tc.sendStreamData)
	tc.streamsMu.Lock()
	tc.streams[streamID] = s
	tc.streamsMu.Unlock()
	return s
}

// CloseStream removes and closes a stream.
func (tc *TunnelClient) CloseStream(streamID uint16) {
	tc.streamsMu.Lock()
	s, ok := tc.streams[streamID]
	if ok {
		delete(tc.streams, streamID)
	}
	tc.streamsMu.Unlock()
	if ok {
		_ = s.Close()
	}
}

// sendStreamData sends a DATA frame for the given stream.
func (tc *TunnelClient) sendStreamData(streamID uint16, data []byte) error {
	frame := &protocol.Frame{
		Type:     protocol.MsgData,
		StreamID: streamID,
		Payload:  data,
	}
	return tc.SendFrame(frame)
}

// readLoop reads frames from the WebSocket and dispatches them.
// A background goroutine watches ctx.Done() and closes the connection to
// unblock the blocking conn.ReadMessage() call.
func (tc *TunnelClient) readLoop(ctx context.Context) {
	tc.connMu.Lock()
	conn := tc.conn
	tc.connMu.Unlock()
	if conn == nil {
		return
	}

	// Watch for context cancellation and close the connection to unblock
	// ReadMessage, which otherwise blocks indefinitely.
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			_ = conn.Close()
		case <-tc.stopCh:
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)

	for {
		_, data, err := conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				// Suppress log noise when the context was cancelled (expected close).
				select {
				case <-ctx.Done():
				default:
					log.Printf("[tunnel] Read error: %v", err)
				}
			}
			return
		}

		frame, _, err := protocol.ParseFrame(data)
		if err != nil {
			log.Printf("[tunnel] Frame parse error: %v", err)
			continue
		}

		tc.dispatchFrame(frame)
	}
}

// dispatchFrame routes a frame to the appropriate handler.
func (tc *TunnelClient) dispatchFrame(frame *protocol.Frame) {
	switch frame.Type {
	case protocol.MsgData:
		tc.streamsMu.RLock()
		s, ok := tc.streams[frame.StreamID]
		tc.streamsMu.RUnlock()
		if ok {
			if !s.deliver(frame.Payload) {
				log.Printf("[tunnel] Stream %d buffer full, dropped %d bytes", frame.StreamID, len(frame.Payload))
			}
		}

	case protocol.MsgClose:
		tc.CloseStream(frame.StreamID)

	case protocol.MsgPing:
		// Respond with PONG
		pong := &protocol.Frame{
			Type:     protocol.MsgPong,
			StreamID: frame.StreamID,
		}
		if err := tc.SendFrame(pong); err != nil {
			log.Printf("[tunnel] Failed to send PONG: %v", err)
		}

	case protocol.MsgPong:
		// Heartbeat acknowledged — no-op

	default:
		// Delegate to the external frame handler (session-layer frames, etc.)
		if tc.frameHandler != nil {
			tc.frameHandler(frame)
		}
	}
}

// heartbeatLoop sends HEARTBEAT frames (type 6) with health metadata and
// empty PING frames (type 4) for RTT measurement at the configured interval.
func (tc *TunnelClient) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(tc.cfg.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// Send HEARTBEAT with health metadata (server parses health from type 6).
			health := tc.probeLocalService()
			payload, _ := json.Marshal(health)
			heartbeat := &protocol.Frame{
				Type:    protocol.MsgHeartbeat,
				Payload: payload,
			}
			if err := tc.SendFrame(heartbeat); err != nil {
				log.Printf("[tunnel] Failed to send HEARTBEAT: %v", err)
			}

			// Send empty PING for RTT measurement (server responds with PONG).
			ping := &protocol.Frame{
				Type: protocol.MsgPing,
			}
			if err := tc.SendFrame(ping); err != nil {
				log.Printf("[tunnel] Failed to send PING: %v", err)
			}
		}
	}
}

// healthStatus is the JSON payload sent in HEARTBEAT frames.
type healthStatus struct {
	Healthy       bool  `json:"healthy"`
	LatencyMs     int64 `json:"latencyMs"`
	ActiveStreams int   `json:"activeStreams"`
}

// probeLocalService checks if the configured local service is reachable.
func (tc *TunnelClient) probeLocalService() healthStatus {
	tc.streamsMu.RLock()
	count := len(tc.streams)
	tc.streamsMu.RUnlock()

	if tc.cfg.LocalPort == 0 {
		return healthStatus{Healthy: true, ActiveStreams: count}
	}

	start := time.Now()
	addr := net.JoinHostPort(tc.cfg.LocalHost, fmt.Sprintf("%d", tc.cfg.LocalPort))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	latency := time.Since(start).Milliseconds()

	if err != nil {
		return healthStatus{Healthy: false, LatencyMs: latency, ActiveStreams: count}
	}
	_ = conn.Close()
	return healthStatus{Healthy: true, LatencyMs: latency, ActiveStreams: count}
}

// waitReconnect waits for the reconnect delay with exponential backoff and
// jitter. Returns false if context is cancelled or the client is stopped
// during the wait.
func (tc *TunnelClient) waitReconnect(ctx context.Context) bool {
	timer := time.NewTimer(tc.reconnectDelay)
	defer timer.Stop()

	// Exponential backoff with jitter (up to 25%) to prevent thundering herd.
	tc.reconnectDelay = tc.reconnectDelay * 2
	if tc.reconnectDelay > tc.cfg.ReconnectMax {
		tc.reconnectDelay = tc.cfg.ReconnectMax
	}
	if tc.reconnectDelay > 0 {
		jitter := time.Duration(rand.Int63n(int64(tc.reconnectDelay / 4)))
		tc.reconnectDelay += jitter
		if tc.reconnectDelay > tc.cfg.ReconnectMax {
			tc.reconnectDelay = tc.cfg.ReconnectMax
		}
	}

	select {
	case <-ctx.Done():
		return false
	case <-tc.stopCh:
		return false
	case <-timer.C:
		return true
	}
}

// closeAllStreams closes and removes all active streams.
func (tc *TunnelClient) closeAllStreams() {
	tc.streamsMu.Lock()
	for id, s := range tc.streams {
		_ = s.Close()
		delete(tc.streams, id)
	}
	tc.streamsMu.Unlock()
}
