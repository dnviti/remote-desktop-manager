package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/gateways/gateway-core/auth"
	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

const certRenewCloseCode = 1012

type Agent struct {
	cfg            Config
	forwarder      *Forwarder
	writeMu        sync.Mutex
	reconnectDelay time.Duration
}

type healthStatus struct {
	Healthy       bool  `json:"healthy"`
	LatencyMs     int64 `json:"latencyMs"`
	ActiveStreams int   `json:"activeStreams"`
}

func NewAgent(cfg Config) *Agent {
	return &Agent{
		cfg:            cfg,
		forwarder:      NewForwarder(),
		reconnectDelay: cfg.ReconnectInitial,
	}
}

func (a *Agent) Run(ctx context.Context) error {
	for {
		if err := ctx.Err(); err != nil {
			a.forwarder.DestroyAll()
			a.log("Agent stopped")
			return err
		}

		conn, err := a.connect(ctx)
		if err != nil {
			a.err("WebSocket error: %v", err)
			if !a.waitReconnect(ctx) {
				a.forwarder.DestroyAll()
				a.log("Agent stopped")
				return ctx.Err()
			}
			continue
		}

		a.log("Connected to TunnelBroker")
		a.reconnectDelay = a.cfg.ReconnectInitial
		readErr := a.runConnection(ctx, conn)
		a.forwarder.DestroyAll()
		_ = conn.Close()
		if errors.Is(readErr, context.Canceled) || ctx.Err() != nil {
			a.log("Agent stopped")
			return ctx.Err()
		}

		a.warn("Connection closed (%v). Reconnecting in %s", readErr, a.reconnectDelay)
		if !a.waitReconnect(ctx) {
			a.forwarder.DestroyAll()
			a.log("Agent stopped")
			return ctx.Err()
		}
	}
}

func (a *Agent) connect(ctx context.Context) (*websocket.Conn, error) {
	a.log("Connecting to %s (gateway=%s)", a.cfg.ServerURL, a.cfg.GatewayID)
	headers := auth.BuildAuthHeadersWithClientCert(a.cfg.Token, a.cfg.GatewayID, a.cfg.AgentVersion, a.cfg.ClientCert)
	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	if strings.HasPrefix(strings.ToLower(a.cfg.ServerURL), "wss://") &&
		(a.cfg.CACert != "" || (a.cfg.ClientCert != "" && a.cfg.ClientKey != "")) {
		tlsConfig, err := auth.BuildTLSConfig(a.cfg.CACert, a.cfg.ClientCert, a.cfg.ClientKey)
		if err != nil {
			return nil, fmt.Errorf("building TLS config: %w", err)
		}
		dialer.TLSClientConfig = tlsConfig
	}
	conn, _, err := dialer.DialContext(ctx, a.cfg.ServerURL, headers)
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func (a *Agent) runConnection(ctx context.Context, conn *websocket.Conn) error {
	pingCtx, cancelPing := context.WithCancel(ctx)
	defer cancelPing()
	go a.pingLoop(pingCtx, conn)

	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			a.writeControl(conn, websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "agent shutdown"))
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)

	for {
		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			if ctx.Err() != nil {
				return context.Canceled
			}
			return err
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		a.handleFrame(conn, payload)
	}
}

func (a *Agent) pingLoop(ctx context.Context, conn *websocket.Conn) {
	ticker := time.NewTicker(a.cfg.PingInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			health := a.probeLocalService()
			payload, err := json.Marshal(health)
			if err != nil {
				a.warn("Failed to encode health payload: %v", err)
				continue
			}
			if err := a.sendFrame(conn, protocol.MsgPing, 0, payload); err != nil {
				a.warn("Failed to send PING: %v", err)
			}
		}
	}
}

func (a *Agent) handleFrame(conn *websocket.Conn, payload []byte) {
	frame, _, err := protocol.ParseFrameAny(payload)
	if err != nil {
		if errors.Is(err, protocol.ErrFrameTooShort) {
			a.warn("Frame too short (%d bytes) - ignored", len(payload))
			return
		}
		a.warn("Frame parse error: %v", err)
		return
	}

	switch frame.Type {
	case protocol.MsgOpen:
		a.forwarder.HandleOpen(conn, frame.StreamID, frame.Payload, a.sendFrame)
	case protocol.MsgData:
		a.forwarder.HandleData(frame.StreamID, frame.Payload)
	case protocol.MsgClose:
		a.forwarder.HandleClose(frame.StreamID)
	case protocol.MsgPing:
		if err := a.sendFrame(conn, protocol.MsgPong, frame.StreamID, nil); err != nil {
			a.warn("Failed to send PONG: %v", err)
		}
	case protocol.MsgPong, protocol.MsgHeartbeat:
	case protocol.MsgCertRenew:
		a.handleCertRenew(conn, frame.Payload)
	default:
		a.warn("Unknown message type %d - ignored", frame.Type)
	}
}

func (a *Agent) handleCertRenew(conn *websocket.Conn, payload []byte) {
	var renew struct {
		ClientCert string `json:"clientCert"`
		ClientKey  string `json:"clientKey"`
	}
	if err := json.Unmarshal(payload, &renew); err != nil {
		a.warn("Certificate renewal ignored: %v", err)
		return
	}
	if renew.ClientCert == "" || renew.ClientKey == "" {
		a.warn("Certificate renewal ignored: payload missing client cert or key")
		return
	}
	a.cfg.ClientCert = renew.ClientCert
	a.cfg.ClientKey = renew.ClientKey
	a.log("Tunnel client certificate renewed - reconnecting")
	a.writeControl(conn, websocket.CloseMessage, websocket.FormatCloseMessage(certRenewCloseCode, "client certificate renewed"))
	_ = conn.Close()
}

func (a *Agent) probeLocalService() healthStatus {
	start := time.Now()
	addr := net.JoinHostPort(a.cfg.LocalServiceHost, fmt.Sprintf("%d", a.cfg.LocalServicePort))
	conn, err := net.DialTimeout("tcp", addr, 2*time.Second)
	latency := time.Since(start).Milliseconds()
	if err != nil {
		return healthStatus{Healthy: false, LatencyMs: latency, ActiveStreams: a.forwarder.ActiveStreamCount()}
	}
	_ = conn.Close()
	return healthStatus{Healthy: true, LatencyMs: latency, ActiveStreams: a.forwarder.ActiveStreamCount()}
}

func (a *Agent) waitReconnect(ctx context.Context) bool {
	timer := time.NewTimer(a.reconnectDelay)
	defer timer.Stop()
	a.reconnectDelay *= 2
	if a.reconnectDelay > a.cfg.ReconnectMax {
		a.reconnectDelay = a.cfg.ReconnectMax
	}
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func (a *Agent) sendFrame(conn *websocket.Conn, frameType byte, streamID uint16, payload []byte) error {
	frame := protocol.BuildFrame(frameType, streamID, payload)
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	return conn.WriteMessage(websocket.BinaryMessage, frame)
}

func (a *Agent) writeControl(conn *websocket.Conn, messageType int, payload []byte) {
	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	_ = conn.WriteControl(messageType, payload, time.Now().Add(5*time.Second))
}

func (a *Agent) log(format string, args ...any) {
	fmt.Fprintf(os.Stdout, "[tunnel-agent] "+format+"\n", args...)
}

func (a *Agent) warn(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[tunnel-agent] WARN "+format+"\n", args...)
}

func (a *Agent) err(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[tunnel-agent] ERROR "+format+"\n", args...)
}
