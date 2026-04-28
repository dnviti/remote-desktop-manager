package main

import (
	"context"
	"encoding/json"
	"errors"
	"net"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type healthStatus struct {
	Healthy       bool `json:"healthy"`
	LatencyMS     int  `json:"latencyMs"`
	ActiveStreams int  `json:"activeStreams"`
}

type tunnelAgent struct {
	cfg       *tunnelConfig
	logger    *agentLogger
	forwarder *tcpForwarder

	mu             sync.Mutex
	writeMu        sync.Mutex
	ws             *websocket.Conn
	reconnectDelay time.Duration
}

func newTunnelAgent(cfg *tunnelConfig, logger *agentLogger) *tunnelAgent {
	agent := &tunnelAgent{
		cfg:            cfg,
		logger:         logger,
		reconnectDelay: cfg.ReconnectInitial,
	}
	agent.forwarder = newTCPForwarder(agent, logger, cfg.LocalServiceHost, cfg.LocalServicePort)
	return agent
}

func (a *tunnelAgent) Run(ctx context.Context) error {
	for {
		if ctx.Err() != nil {
			a.closeWebSocket(websocket.CloseGoingAway, "agent shutdown")
			a.forwarder.destroyAllSockets()
			a.log("Agent stopped")
			return nil
		}

		conn, err := a.connect(ctx)
		if err != nil {
			a.err("WebSocket error: %v", err)
			if !a.waitReconnect(ctx) {
				a.forwarder.destroyAllSockets()
				a.log("Agent stopped")
				return nil
			}
			continue
		}

		a.setWebSocket(conn)
		a.reconnectDelay = a.cfg.ReconnectInitial
		a.log("Connected to TunnelBroker")

		heartbeatCtx, cancelHeartbeat := context.WithCancel(ctx)
		go a.heartbeatLoop(heartbeatCtx)

		readErr := a.readLoop(ctx, conn)
		cancelHeartbeat()
		a.clearWebSocket(conn)
		a.forwarder.destroyAllSockets()
		_ = conn.Close()

		if ctx.Err() != nil {
			a.log("Agent stopped")
			return nil
		}
		if readErr != nil {
			a.warn("Connection closed (%v). Reconnecting in %s", readErr, a.reconnectDelay)
		} else {
			a.warn("Connection closed. Reconnecting in %s", a.reconnectDelay)
		}
		if !a.waitReconnect(ctx) {
			a.log("Agent stopped")
			return nil
		}
	}
}

func (a *tunnelAgent) connect(ctx context.Context) (*websocket.Conn, error) {
	a.log("Connecting to %s (gateway=%s)", a.cfg.ServerURL, a.cfg.GatewayID)
	dialer, err := buildDialer(a.cfg)
	if err != nil {
		return nil, err
	}
	conn, _, err := dialer.DialContext(ctx, a.cfg.ServerURL, buildAuthHeaders(a.cfg))
	if err != nil {
		return nil, err
	}
	return conn, nil
}

func (a *tunnelAgent) readLoop(ctx context.Context, conn *websocket.Conn) error {
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			a.writeMu.Lock()
			_ = conn.WriteControl(
				websocket.CloseMessage,
				websocket.FormatCloseMessage(websocket.CloseGoingAway, "agent shutdown"),
				time.Now().Add(time.Second),
			)
			a.writeMu.Unlock()
			_ = conn.Close()
		case <-done:
		}
	}()
	defer close(done)

	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			return err
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		if err := a.handleMessage(data); err != nil {
			a.warn("%v - ignored", err)
		}
	}
}

func (a *tunnelAgent) handleMessage(data []byte) error {
	frame, err := parseFrame(data)
	if err != nil {
		if errors.Is(err, errFrameTooShort) {
			return errors.New("frame too short")
		}
		return err
	}

	switch frame.Type {
	case msgOpen:
		a.forwarder.handleOpenFrame(frame.StreamID, frame.Payload)
	case msgData:
		a.forwarder.handleDataFrame(frame.StreamID, frame.Payload)
	case msgClose:
		a.forwarder.handleCloseFrame(frame.StreamID)
	case msgPing:
		if err := a.SendFrame(msgPong, frame.StreamID, nil); err != nil {
			a.warn("Failed to send PONG: %v", err)
		}
	case msgPong:
	case msgHeartbeat:
	case msgCertRenew:
		a.handleCertRenew(frame.Payload)
	default:
		a.warn("Unknown message type %d - ignored", frame.Type)
	}
	return nil
}

func (a *tunnelAgent) handleCertRenew(payload []byte) {
	var renewal struct {
		ClientCert string `json:"clientCert"`
		ClientKey  string `json:"clientKey"`
	}
	if err := json.Unmarshal(payload, &renewal); err != nil {
		a.warn("Certificate renewal ignored: %v", err)
		return
	}
	if renewal.ClientCert == "" || renewal.ClientKey == "" {
		a.warn("Certificate renewal ignored: payload missing client cert or key")
		return
	}

	a.cfg.ClientCert = renewal.ClientCert
	a.cfg.ClientKey = renewal.ClientKey
	a.log("Tunnel client certificate renewed - reconnecting")
	a.closeWebSocket(websocket.CloseServiceRestart, "client certificate renewed")
}

func (a *tunnelAgent) heartbeatLoop(ctx context.Context) {
	ticker := time.NewTicker(a.cfg.PingInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			health := a.probeLocalService()
			payload, _ := json.Marshal(health)
			if err := a.SendFrame(msgPing, 0, payload); err != nil {
				a.warn("Failed to send PING: %v", err)
			}
		}
	}
}

func (a *tunnelAgent) probeLocalService() healthStatus {
	start := time.Now()
	address := net.JoinHostPort(a.cfg.LocalServiceHost, strconv.Itoa(a.cfg.LocalServicePort))
	conn, err := net.DialTimeout("tcp", address, 2*time.Second)
	latency := int(time.Since(start).Milliseconds())
	if err != nil {
		return healthStatus{Healthy: false, LatencyMS: latency, ActiveStreams: a.forwarder.activeStreamCount()}
	}
	_ = conn.Close()
	return healthStatus{Healthy: true, LatencyMS: latency, ActiveStreams: a.forwarder.activeStreamCount()}
}

func (a *tunnelAgent) waitReconnect(ctx context.Context) bool {
	delay := a.reconnectDelay
	timer := time.NewTimer(delay)
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

func (a *tunnelAgent) SendFrame(frameType byte, streamID uint16, payload []byte) error {
	frame, err := buildFrame(frameType, streamID, payload)
	if err != nil {
		return err
	}

	a.writeMu.Lock()
	defer a.writeMu.Unlock()
	a.mu.Lock()
	conn := a.ws
	a.mu.Unlock()
	if conn == nil {
		return errors.New("websocket is not connected")
	}
	return conn.WriteMessage(websocket.BinaryMessage, frame)
}

func (a *tunnelAgent) Ready() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.ws != nil
}

func (a *tunnelAgent) setWebSocket(conn *websocket.Conn) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.ws = conn
}

func (a *tunnelAgent) clearWebSocket(conn *websocket.Conn) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.ws == conn {
		a.ws = nil
	}
}

func (a *tunnelAgent) closeWebSocket(code int, reason string) {
	a.mu.Lock()
	conn := a.ws
	a.mu.Unlock()
	if conn == nil {
		return
	}
	a.writeMu.Lock()
	_ = conn.WriteControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(code, reason),
		time.Now().Add(time.Second),
	)
	a.writeMu.Unlock()
	_ = conn.Close()
}

func (a *tunnelAgent) log(format string, args ...any) {
	if a.logger != nil {
		a.logger.log(format, args...)
	}
}

func (a *tunnelAgent) warn(format string, args ...any) {
	if a.logger != nil {
		a.logger.warn(format, args...)
	}
}

func (a *tunnelAgent) err(format string, args ...any) {
	if a.logger != nil {
		a.logger.err(format, args...)
	}
}
