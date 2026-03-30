package tunnelbroker

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const (
	frameHeaderSize          = 4
	maxStreamID              = 0xffff
	defaultOpenTimeout       = 10 * time.Second
	defaultProxyIdleTimeout  = 60 * time.Second
	defaultTrustDomain       = "arsenale.local"
	aesKeyBytes              = 32
	aesIVBytes               = 16
)

type msgType byte

const (
	msgOpen msgType = 1
	msgData msgType = 2
	msgClose msgType = 3
	msgPing msgType = 4
	msgPong msgType = 5
	msgHeartbeat msgType = 6
	msgCertRenew msgType = 7
)

type HeartbeatMetadata struct {
	Healthy       bool `json:"healthy"`
	LatencyMs     *int `json:"latencyMs,omitempty"`
	ActiveStreams *int `json:"activeStreams,omitempty"`
}

type BrokerConfig struct {
	Store             Store
	Logger            *slog.Logger
	ServerEncryptionKey []byte
	SpiffeTrustDomain string
	ProxyBindHost     string
	ProxyAdvertiseHost string
}

type Broker struct {
	config   BrokerConfig
	upgrader websocket.Upgrader

	mu       sync.RWMutex
	registry map[string]*tunnelConnection
}

type tunnelConnection struct {
	broker         *Broker
	gatewayID      string
	ws             *websocket.Conn
	connectedAt    time.Time
	clientVersion  string
	clientIP       string
	lastHeartbeat  time.Time
	lastPingSentAt time.Time
	pingLatency    *int64
	bytesTransferred int64
	heartbeat      *HeartbeatMetadata

	sendMu       sync.Mutex
	streams      map[uint16]*streamConn
	pendingOpens map[uint16]*pendingOpen
	nextStreamID uint16
}

type pendingOpen struct {
	resolve chan *streamConn
	timer   *time.Timer
}

type streamConn struct {
	parent *tunnelConnection
	id     uint16

	reader *io.PipeReader
	writer *io.PipeWriter

	closeOnce sync.Once
	closed    chan struct{}
}

func NewBroker(config BrokerConfig) *Broker {
	if config.Store == nil {
		config.Store = NoopStore{}
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	if strings.TrimSpace(config.SpiffeTrustDomain) == "" {
		config.SpiffeTrustDomain = defaultTrustDomain
	}
	if strings.TrimSpace(config.ProxyBindHost) == "" {
		config.ProxyBindHost = "0.0.0.0"
	}
	if strings.TrimSpace(config.ProxyAdvertiseHost) == "" {
		config.ProxyAdvertiseHost = strings.TrimSpace(os.Getenv("HOSTNAME"))
		if config.ProxyAdvertiseHost == "" {
			config.ProxyAdvertiseHost = "tunnel-broker-go"
		}
	}

	return &Broker{
		config: config,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
		registry: make(map[string]*tunnelConnection),
	}
}

func (b *Broker) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/tunnel/connect", b.HandleTunnelConnect)
	mux.HandleFunc("GET /v1/tunnels", b.HandleTunnelList)
	mux.HandleFunc("GET /v1/tunnels/{gatewayId}", b.HandleTunnelGet)
	mux.HandleFunc("DELETE /v1/tunnels/{gatewayId}", b.HandleTunnelDelete)
	mux.HandleFunc("POST /v1/tcp-proxies", b.HandleCreateTCPProxy)
}

func (b *Broker) HandleTunnelConnect(w http.ResponseWriter, r *http.Request) {
	gatewayID := strings.TrimSpace(r.Header.Get("X-Gateway-Id"))
	bearerToken := strings.TrimSpace(strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer "))
	clientVersion := strings.TrimSpace(r.Header.Get("X-Agent-Version"))
	clientIP := extractClientIP(r)
	clientCertPEM, err := parseClientCertHeader(r.Header.Get("X-Client-Cert"))
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "invalid x-client-cert header")
		return
	}
	if gatewayID == "" || bearerToken == "" || clientCertPEM == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "missing tunnel authentication headers")
		return
	}

	if _, err := b.authenticateTunnel(r.Context(), gatewayID, bearerToken, clientCertPEM); err != nil {
		b.config.Logger.Warn("tunnel authentication failed", "gateway_id", gatewayID, "error", err)
		_ = b.config.Store.InsertTunnelAudit(r.Context(), "TUNNEL_MTLS_REJECTED", gatewayID, clientIP, map[string]any{
			"reason": err.Error(),
		})
		app.ErrorJSON(w, http.StatusForbidden, "tunnel authentication failed")
		return
	}

	wsConn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	conn := b.registerConnection(gatewayID, wsConn, clientVersion, clientIP)
	if err := b.config.Store.MarkTunnelConnected(r.Context(), gatewayID, conn.connectedAt, clientVersion, clientIP); err != nil {
		b.config.Logger.Warn("persist tunnel connect failed", "gateway_id", gatewayID, "error", err)
	}
	if err := b.config.Store.InsertTunnelAudit(r.Context(), "TUNNEL_CONNECT", gatewayID, clientIP, map[string]any{
		"clientVersion": clientVersion,
		"clientIp":      clientIP,
	}); err != nil {
		b.config.Logger.Warn("insert tunnel connect audit failed", "gateway_id", gatewayID, "error", err)
	}
}

func (b *Broker) HandleTunnelList(w http.ResponseWriter, _ *http.Request) {
	b.mu.RLock()
	statuses := make([]contracts.TunnelStatus, 0, len(b.registry))
	for _, conn := range b.registry {
		statuses = append(statuses, describeConnection(conn))
	}
	b.mu.RUnlock()
	app.WriteJSON(w, http.StatusOK, contracts.TunnelStatusesResponse{Tunnels: statuses})
}

func (b *Broker) HandleTunnelGet(w http.ResponseWriter, r *http.Request) {
	gatewayID := strings.TrimSpace(r.PathValue("gatewayId"))
	status, ok := b.getStatus(gatewayID)
	if !ok {
		app.ErrorJSON(w, http.StatusNotFound, "tunnel not found")
		return
	}
	app.WriteJSON(w, http.StatusOK, status)
}

func (b *Broker) HandleTunnelDelete(w http.ResponseWriter, r *http.Request) {
	gatewayID := strings.TrimSpace(r.PathValue("gatewayId"))
	if gatewayID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "gatewayId is required")
		return
	}
	if !b.disconnectTunnel(gatewayID, "revoked") {
		app.ErrorJSON(w, http.StatusNotFound, "tunnel not found")
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"disconnected": true, "gatewayId": gatewayID})
}

func (b *Broker) HandleCreateTCPProxy(w http.ResponseWriter, r *http.Request) {
	var req contracts.TunnelProxyRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(req.GatewayID) == "" || strings.TrimSpace(req.TargetHost) == "" || req.TargetPort <= 0 {
		app.ErrorJSON(w, http.StatusBadRequest, "gatewayId, targetHost and targetPort are required")
		return
	}

	proxy, err := b.createTCPProxy(req)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, proxy)
}

func (b *Broker) authenticateTunnel(ctx context.Context, gatewayID, bearerToken, clientCertPEM string) (GatewayAuthRecord, error) {
	record, err := b.config.Store.LoadGatewayAuth(ctx, gatewayID)
	if err != nil {
		return GatewayAuthRecord{}, fmt.Errorf("load gateway auth: %w", err)
	}
	if !record.TunnelEnabled || record.TunnelTokenHash == "" {
		return GatewayAuthRecord{}, errors.New("gateway tunneling is disabled")
	}

	if hashToken(bearerToken) != record.TunnelTokenHash {
		return GatewayAuthRecord{}, errors.New("tunnel token mismatch")
	}
	if record.EncryptedTunnelToken != "" && record.TunnelTokenIV != "" && record.TunnelTokenTag != "" {
		plain, err := decryptWithServerKey(b.config.ServerEncryptionKey, record.EncryptedTunnelToken, record.TunnelTokenIV, record.TunnelTokenTag)
		if err != nil {
			return GatewayAuthRecord{}, fmt.Errorf("decrypt tunnel token: %w", err)
		}
		if subtle.ConstantTimeCompare([]byte(plain), []byte(bearerToken)) != 1 {
			return GatewayAuthRecord{}, errors.New("encrypted tunnel token mismatch")
		}
	}

	cert, err := parseClientCert(clientCertPEM)
	if err != nil {
		return GatewayAuthRecord{}, fmt.Errorf("parse client certificate: %w", err)
	}

	expectedSPIFFE := buildGatewaySPIFFEID(b.config.SpiffeTrustDomain, gatewayID)
	actualSPIFFE := extractSPIFFEID(cert)
	if subtle.ConstantTimeCompare([]byte(actualSPIFFE), []byte(expectedSPIFFE)) != 1 {
		return GatewayAuthRecord{}, fmt.Errorf("client certificate SPIFFE ID mismatch: got %q expected %q", actualSPIFFE, expectedSPIFFE)
	}

	if record.TenantTunnelCACertPEM != "" {
		if err := verifyCertChain(cert, record.TenantTunnelCACertPEM); err != nil {
			return GatewayAuthRecord{}, fmt.Errorf("client certificate does not chain to tenant CA: %w", err)
		}
	}

	return record, nil
}

func (b *Broker) registerConnection(gatewayID string, wsConn *websocket.Conn, clientVersion, clientIP string) *tunnelConnection {
	b.mu.Lock()
	defer b.mu.Unlock()

	if existing := b.registry[gatewayID]; existing != nil {
		_ = existing.ws.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseGoingAway, "replaced"), time.Now().Add(5*time.Second))
		_ = existing.ws.Close()
		b.evictConnectionLocked(existing)
	}

	conn := &tunnelConnection{
		broker:         b,
		gatewayID:      gatewayID,
		ws:             wsConn,
		connectedAt:    time.Now().UTC(),
		clientVersion:  clientVersion,
		clientIP:       clientIP,
		streams:        make(map[uint16]*streamConn),
		pendingOpens:   make(map[uint16]*pendingOpen),
		nextStreamID:   1,
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
		if len(payload) < frameHeaderSize {
			continue
		}

		frameType := msgType(payload[0])
		streamID := uint16(payload[2])<<8 | uint16(payload[3])
		body := payload[frameHeaderSize:]

		switch frameType {
		case msgOpen:
			b.handleOpenAck(conn, streamID)
		case msgData:
			b.handleData(conn, streamID, body)
		case msgClose:
			b.handleClose(conn, streamID)
		case msgPing:
			b.recordHeartbeat(conn, body)
			_ = b.sendFrame(conn, msgPong, streamID, nil)
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
			b.recordHeartbeat(conn, body)
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

func (b *Broker) openStream(gatewayID, host string, port int, timeout time.Duration) (*streamConn, error) {
	b.mu.Lock()
	conn := b.registry[gatewayID]
	if conn == nil {
		b.mu.Unlock()
		return nil, fmt.Errorf("no active tunnel for gateway %s", gatewayID)
	}

	streamID, ok := allocateStreamID(conn)
	if !ok {
		b.mu.Unlock()
		return nil, errors.New("no available tunnel stream IDs")
	}

	wait := &pendingOpen{resolve: make(chan *streamConn, 1)}
	wait.timer = time.AfterFunc(timeout, func() {
		b.mu.Lock()
		current := conn.pendingOpens[streamID]
		if current == wait {
			delete(conn.pendingOpens, streamID)
		}
		b.mu.Unlock()
		if current == wait {
			select {
			case wait.resolve <- nil:
			default:
			}
		}
	})
	conn.pendingOpens[streamID] = wait
	b.mu.Unlock()

	target := []byte(net.JoinHostPort(host, strconv.Itoa(port)))
	if err := b.sendFrame(conn, msgOpen, streamID, target); err != nil {
		wait.timer.Stop()
		b.mu.Lock()
		delete(conn.pendingOpens, streamID)
		b.mu.Unlock()
		return nil, err
	}

	stream, ok := <-wait.resolve
	if !ok || stream == nil {
		return nil, fmt.Errorf("openStream timeout for gateway %s -> %s:%d", gatewayID, host, port)
	}
	return stream, nil
}

func (b *Broker) createTCPProxy(req contracts.TunnelProxyRequest) (contracts.TunnelProxyResponse, error) {
	timeout := defaultOpenTimeout
	if req.TimeoutMs > 0 {
		timeout = time.Duration(req.TimeoutMs) * time.Millisecond
	}
	idleTimeout := defaultProxyIdleTimeout
	if req.IdleTimeout > 0 {
		idleTimeout = time.Duration(req.IdleTimeout) * time.Millisecond
	}

	listener, err := net.Listen("tcp", net.JoinHostPort(b.config.ProxyBindHost, "0"))
	if err != nil {
		return contracts.TunnelProxyResponse{}, fmt.Errorf("listen tunnel proxy: %w", err)
	}

	proxyID := uuid.NewString()
	idleTimer := time.AfterFunc(idleTimeout, func() {
		_ = listener.Close()
	})

	go func() {
		defer idleTimer.Stop()
		defer listener.Close()

		socket, err := listener.Accept()
		if err != nil {
			return
		}
		idleTimer.Stop()
		defer socket.Close()

		stream, err := b.openStream(req.GatewayID, req.TargetHost, req.TargetPort, timeout)
		if err != nil {
			return
		}
		defer stream.close(true)

		done := make(chan struct{}, 2)
		go func() {
			_, _ = io.Copy(stream, socket)
			_ = stream.close(true)
			done <- struct{}{}
		}()
		go func() {
			_, _ = io.Copy(socket, stream)
			_ = socket.Close()
			done <- struct{}{}
		}()
		<-done
	}()

	address, ok := listener.Addr().(*net.TCPAddr)
	if !ok {
		_ = listener.Close()
		return contracts.TunnelProxyResponse{}, errors.New("unexpected tunnel proxy listener type")
	}

	return contracts.TunnelProxyResponse{
		ID:        proxyID,
		Host:      b.config.ProxyAdvertiseHost,
		Port:      address.Port,
		ExpiresIn: int(idleTimeout / time.Millisecond),
	}, nil
}

func (b *Broker) sendFrame(conn *tunnelConnection, frameType msgType, streamID uint16, payload []byte) error {
	frame := buildFrame(frameType, streamID, payload)
	conn.sendMu.Lock()
	defer conn.sendMu.Unlock()
	return conn.ws.WriteMessage(websocket.BinaryMessage, frame)
}

func newStreamConn(parent *tunnelConnection, streamID uint16) *streamConn {
	reader, writer := io.Pipe()
	return &streamConn{
		parent: parent,
		id:     streamID,
		reader: reader,
		writer: writer,
		closed: make(chan struct{}),
	}
}

func (s *streamConn) Read(p []byte) (int, error) {
	return s.reader.Read(p)
}

func (s *streamConn) Write(p []byte) (int, error) {
	select {
	case <-s.closed:
		return 0, io.ErrClosedPipe
	default:
	}
	if err := s.parent.broker.sendFrame(s.parent, msgData, s.id, p); err != nil {
		return 0, err
	}
	s.parent.bytesTransferred += int64(len(p))
	return len(p), nil
}

func (s *streamConn) Close() error {
	return s.close(true)
}

func (s *streamConn) close(sendClose bool) error {
	var err error
	s.closeOnce.Do(func() {
		close(s.closed)
		if sendClose {
			err = s.parent.broker.sendFrame(s.parent, msgClose, s.id, nil)
		}
		s.parent.broker.mu.Lock()
		delete(s.parent.streams, s.id)
		s.parent.broker.mu.Unlock()
		_ = s.writer.Close()
		_ = s.reader.Close()
	})
	return err
}

func allocateStreamID(conn *tunnelConnection) (uint16, bool) {
	streamID := conn.nextStreamID
	for attempts := 0; attempts < maxStreamID; attempts++ {
		if streamID == 0 {
			streamID = 1
		}
		if conn.streams[streamID] == nil && conn.pendingOpens[streamID] == nil {
			conn.nextStreamID = streamID + 1
			return streamID, true
		}
		streamID++
		if streamID > maxStreamID {
			streamID = 1
		}
	}
	return 0, false
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

func buildFrame(frameType msgType, streamID uint16, payload []byte) []byte {
	frame := make([]byte, frameHeaderSize+len(payload))
	frame[0] = byte(frameType)
	frame[1] = 0
	frame[2] = byte(streamID >> 8)
	frame[3] = byte(streamID)
	copy(frame[frameHeaderSize:], payload)
	return frame
}

func parseClientCertHeader(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", nil
	}
	decoded, err := url.QueryUnescape(value)
	if err != nil {
		return "", err
	}
	return decoded, nil
}

func parseClientCert(certPEM string) (*x509.Certificate, error) {
	block, _ := pem.Decode([]byte(certPEM))
	if block == nil {
		return nil, errors.New("missing PEM block")
	}
	return x509.ParseCertificate(block.Bytes)
}

func verifyCertChain(cert *x509.Certificate, caPEM string) error {
	roots := x509.NewCertPool()
	if !roots.AppendCertsFromPEM([]byte(caPEM)) {
		return errors.New("failed to parse tenant CA certificate")
	}
	_, err := cert.Verify(x509.VerifyOptions{
		Roots:       roots,
		CurrentTime: time.Now(),
		KeyUsages:   []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	})
	return err
}

func buildGatewaySPIFFEID(trustDomain, gatewayID string) string {
	return fmt.Sprintf("spiffe://%s/gateway/%s", strings.ToLower(strings.TrimSpace(trustDomain)), url.PathEscape(strings.TrimSpace(gatewayID)))
}

func extractSPIFFEID(cert *x509.Certificate) string {
	for _, uri := range cert.URIs {
		if uri == nil {
			continue
		}
		if uri.Scheme == "spiffe" {
			return uri.String()
		}
	}
	return ""
}

func extractClientIP(r *http.Request) string {
	if forwarded := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); forwarded != "" {
		return forwarded
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func decryptWithServerKey(key []byte, ciphertextHex, ivHex, tagHex string) (string, error) {
	if len(key) == 0 {
		return "", errors.New("server encryption key is required")
	}
	if len(key) != aesKeyBytes {
		return "", fmt.Errorf("server encryption key must be %d bytes", aesKeyBytes)
	}
	ciphertext, err := hex.DecodeString(ciphertextHex)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	tag, err := hex.DecodeString(tagHex)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	if len(iv) != aesIVBytes {
		return "", fmt.Errorf("invalid iv length %d", len(iv))
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, aesIVBytes)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	plaintext, err := aead.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}
	return string(plaintext), nil
}

func LoadServerEncryptionKey() ([]byte, error) {
	raw := strings.TrimSpace(os.Getenv("SERVER_ENCRYPTION_KEY"))
	if raw == "" {
		if path := strings.TrimSpace(os.Getenv("SERVER_ENCRYPTION_KEY_FILE")); path != "" {
			payload, err := os.ReadFile(path)
			if err != nil {
				return nil, fmt.Errorf("read SERVER_ENCRYPTION_KEY_FILE: %w", err)
			}
			raw = strings.TrimSpace(string(payload))
		}
	}
	if raw == "" {
		return nil, nil
	}
	if len(raw) != aesKeyBytes*2 {
		return nil, fmt.Errorf("SERVER_ENCRYPTION_KEY must be exactly %d hex characters", aesKeyBytes*2)
	}
	key, err := hex.DecodeString(raw)
	if err != nil {
		return nil, fmt.Errorf("decode SERVER_ENCRYPTION_KEY: %w", err)
	}
	return key, nil
}
