package tunnelbroker

import (
	"context"
	"encoding/json"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
)

func (b *Broker) registerConnection(gatewayID string, wsConn *websocket.Conn, clientVersion, clientIP string) *tunnelConnection {
	b.mu.Lock()
	defer b.mu.Unlock()

	if existing := b.registry[gatewayID]; existing != nil {
		_ = existing.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "replaced"), time.Now().Add(5*time.Second))
		_ = existing.ws.Close()
		b.evictConnectionLocked(existing)
	}

	conn := &tunnelConnection{
		broker:        b,
		gatewayID:     gatewayID,
		ws:            wsConn,
		connectedAt:   time.Now().UTC(),
		clientVersion: clientVersion,
		clientIP:      clientIP,
		streams:       make(map[uint16]*streamConn),
		pendingOpens:  make(map[uint16]*pendingOpen),
		nextStreamID:  1,
	}
	b.registry[gatewayID] = conn
	go b.readLoop(conn)
	return conn
}

func (b *Broker) readLoop(conn *tunnelConnection) {
	defer func() {
		b.cleanupConnection(conn, "client_closed")
	}()

	for {
		messageType, payload, err := conn.ws.ReadMessage()
		if err != nil {
			return
		}
		if messageType != websocket.BinaryMessage {
			continue
		}
		frame, ok := parseFrame(payload)
		if !ok {
			continue
		}

		switch frame.Type {
		case msgOpen:
			b.handleOpenAck(conn, frame.StreamID)
		case msgData:
			b.handleData(conn, frame.StreamID, frame.Payload)
		case msgClose:
			b.handleClose(conn, frame.StreamID)
		case msgPing:
			b.recordHeartbeat(conn, frame.Payload)
			_ = b.sendFrame(conn, msgPong, frame.StreamID, nil)
		case msgPong:
			now := time.Now().UTC()
			if !conn.lastPingSentAt.IsZero() {
				latency := now.Sub(conn.lastPingSentAt).Milliseconds()
				conn.pingLatency = &latency
				conn.lastPingSentAt = time.Time{}
			}
			conn.lastHeartbeat = now
			_ = b.config.Store.MarkTunnelHeartbeat(context.Background(), conn.gatewayID, now, conn.heartbeat)
		case msgHeartbeat:
			b.recordHeartbeat(conn, frame.Payload)
		case msgCertRenew:
			// The current tunnel agent only receives CERT_RENEW from the broker.
			// Ignore any peer-sent CERT_RENEW frame.
		}
	}
}

func (b *Broker) handleOpenAck(conn *tunnelConnection, streamID uint16) {
	b.mu.Lock()
	pending := conn.pendingOpens[streamID]
	if pending != nil {
		delete(conn.pendingOpens, streamID)
	}
	b.mu.Unlock()
	if pending == nil {
		return
	}

	pending.timer.Stop()
	stream := newStreamConn(conn, streamID)

	b.mu.Lock()
	conn.streams[streamID] = stream
	b.mu.Unlock()

	pending.resolve <- stream
}

func (b *Broker) handleData(conn *tunnelConnection, streamID uint16, payload []byte) {
	b.mu.RLock()
	stream := conn.streams[streamID]
	b.mu.RUnlock()
	if stream == nil {
		return
	}
	conn.bytesTransferred += int64(len(payload))
	_, _ = stream.writer.Write(payload)
}

func (b *Broker) handleClose(conn *tunnelConnection, streamID uint16) {
	b.mu.Lock()
	stream := conn.streams[streamID]
	delete(conn.streams, streamID)
	b.mu.Unlock()
	if stream != nil {
		_ = stream.close(false)
	}
}

func (b *Broker) recordHeartbeat(conn *tunnelConnection, payload []byte) {
	now := time.Now().UTC()
	conn.lastHeartbeat = now

	if len(payload) > 0 {
		var heartbeat HeartbeatMetadata
		if err := json.Unmarshal(payload, &heartbeat); err == nil {
			conn.heartbeat = &heartbeat
		} else {
			conn.heartbeat = &HeartbeatMetadata{Healthy: true}
		}
	} else {
		conn.heartbeat = &HeartbeatMetadata{Healthy: true}
	}

	if err := b.config.Store.MarkTunnelHeartbeat(context.Background(), conn.gatewayID, now, conn.heartbeat); err != nil {
		b.config.Logger.Warn("persist tunnel heartbeat failed", "gateway_id", conn.gatewayID, "error", err)
	}
}

func (b *Broker) cleanupConnection(conn *tunnelConnection, reason string) {
	b.mu.Lock()
	if current := b.registry[conn.gatewayID]; current != conn {
		b.mu.Unlock()
		return
	}
	delete(b.registry, conn.gatewayID)
	pending := conn.pendingOpens
	streams := conn.streams
	conn.pendingOpens = make(map[uint16]*pendingOpen)
	conn.streams = make(map[uint16]*streamConn)
	b.mu.Unlock()

	for _, stream := range streams {
		_ = stream.close(false)
	}
	for _, wait := range pending {
		wait.timer.Stop()
		select {
		case wait.resolve <- nil:
		default:
		}
	}

	_ = conn.ws.Close()
	if err := b.config.Store.MarkTunnelDisconnected(context.Background(), conn.gatewayID); err != nil {
		b.config.Logger.Warn("persist tunnel disconnect failed", "gateway_id", conn.gatewayID, "error", err)
	}
	if err := b.config.Store.InsertTunnelAudit(context.Background(), "TUNNEL_DISCONNECT", conn.gatewayID, conn.clientIP, map[string]any{
		"reason": reason,
	}); err != nil {
		b.config.Logger.Warn("insert tunnel disconnect audit failed", "gateway_id", conn.gatewayID, "error", err)
	}
}

func (b *Broker) evictConnectionLocked(conn *tunnelConnection) {
	delete(b.registry, conn.gatewayID)
	for streamID, stream := range conn.streams {
		delete(conn.streams, streamID)
		_ = stream.close(false)
	}
	for streamID, pending := range conn.pendingOpens {
		delete(conn.pendingOpens, streamID)
		pending.timer.Stop()
		select {
		case pending.resolve <- nil:
		default:
		}
	}
}

func (b *Broker) getStatus(gatewayID string) (contracts.TunnelStatus, bool) {
	b.mu.RLock()
	conn := b.registry[gatewayID]
	b.mu.RUnlock()
	if conn == nil {
		return contracts.TunnelStatus{}, false
	}
	return describeConnection(conn), true
}

func (b *Broker) disconnectTunnel(gatewayID, reason string) bool {
	b.mu.RLock()
	conn := b.registry[gatewayID]
	b.mu.RUnlock()
	if conn == nil {
		return false
	}
	_ = conn.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, reason), time.Now().Add(5*time.Second))
	b.cleanupConnection(conn, reason)
	return true
}

func describeConnection(conn *tunnelConnection) contracts.TunnelStatus {
	status := contracts.TunnelStatus{
		GatewayID:        conn.gatewayID,
		Connected:        true,
		ConnectedAt:      conn.connectedAt.Format(time.RFC3339),
		ClientVersion:    conn.clientVersion,
		ClientIP:         conn.clientIP,
		ActiveStreams:    len(conn.streams),
		BytesTransferred: conn.bytesTransferred,
	}
	if !conn.lastHeartbeat.IsZero() {
		status.LastHeartbeatAt = conn.lastHeartbeat.Format(time.RFC3339)
	}
	if conn.pingLatency != nil {
		value := *conn.pingLatency
		status.PingPongLatencyMs = &value
	}
	if conn.heartbeat != nil {
		status.Heartbeat = &contracts.TunnelHeartbeat{
			Healthy:       conn.heartbeat.Healthy,
			LatencyMs:     conn.heartbeat.LatencyMs,
			ActiveStreams: conn.heartbeat.ActiveStreams,
		}
	}
	return status
}
