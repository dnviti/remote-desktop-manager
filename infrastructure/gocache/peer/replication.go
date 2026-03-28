// Package peer - replication engine for cross-peer KV, PubSub, and lock state.
//
// Features:
//   - mTLS for peer-to-peer connections (when CACHE_TLS_* are configured)
//   - Peer certificate SPIFFE ID verification (prevents non-cache services from injecting data)
//   - Full-state sync on peer connect/reconnect (snapshot transfer)
//   - ACK-based flow control in sync mode (wait for at least one peer ACK per write)
//   - Buffering with configurable entry-count limit during disconnections
package peer

import (
	"bufio"
	"container/list"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"

	spiffeid "github.com/dnviti/arsenale/infrastructure/gocache/spiffe"
)

const (
	defaultMaxBufferEntries = 10000
	reconnectInterval       = 2 * time.Second
	writeTimeout            = 5 * time.Second
	ackTimeout              = 5 * time.Second
	syncReadTimeout         = 30 * time.Second
	maxLineLength           = 1 << 20 // 1MB max line length to prevent OOM
)

// ReplicationOp is the type of operation to replicate.
type ReplicationOp int

const (
	OpKVSet ReplicationOp = iota + 1
	OpKVDelete
	OpPubSub
	OpSyncReq  // Request full-state sync. Timestamp = requester's logical clock.
	OpSyncDone // Marks end of snapshot stream.
	OpAck      // Acknowledgment for sync-mode flow control.
)

// ReplicationEntry is a single replication event.
type ReplicationEntry struct {
	Op        ReplicationOp `json:"op"`
	Key       string        `json:"key,omitempty"`
	Value     []byte        `json:"value,omitempty"`
	TTLMs     int64         `json:"ttl_ms,omitempty"`
	Channel   string        `json:"channel,omitempty"`
	Message   []byte        `json:"message,omitempty"`
	Timestamp uint64        `json:"timestamp"`
}

// peerConn tracks a connection to a single peer.
type peerConn struct {
	mu          sync.Mutex
	sendMu      sync.Mutex // serializes sync-mode sends per peer
	addr        string
	conn        net.Conn
	connected   bool
	buffer      *list.List
	bufferCount int
	ackCh       chan struct{} // signals ACK received (for sync mode)
}

// Engine handles replication to all peers.
type Engine struct {
	registry         *Registry
	mu               sync.RWMutex
	peers            map[string]*peerConn
	logicalClock     atomic.Uint64
	maxBufferEntries int
	stopCh           chan struct{}

	// TLS configuration for peer-to-peer mTLS.
	tlsEnabled bool
	peerCert   tls.Certificate
	peerCAPool *x509.CertPool
	// PeerSPIFFEID is the required SPIFFE ID for peer certificates.
	PeerSPIFFEID string

	// SyncMode: when true, broadcast blocks until at least one peer ACKs.
	SyncMode bool

	// SnapshotProvider returns the full store state for new/reconnecting peers.
	// Set by main.go to bridge the kv.Store snapshot into ReplicationEntry format.
	SnapshotProvider func() []ReplicationEntry

	// Callbacks for applying replicated operations locally.
	OnKVSet    func(key string, value []byte, ttlMs int64, timestamp uint64)
	OnKVDelete func(key string, timestamp uint64)
	OnPubSub   func(channel string, message []byte)
}

// NewEngine creates a new replication Engine.
func NewEngine(registry *Registry, maxBuffer int) *Engine {
	if maxBuffer <= 0 {
		maxBuffer = defaultMaxBufferEntries
	}
	e := &Engine{
		registry:         registry,
		peers:            make(map[string]*peerConn),
		maxBufferEntries: maxBuffer,
		stopCh:           make(chan struct{}),
	}

	// Listen for peer list changes.
	registry.OnUpdate(func(peers []*Peer) {
		e.updatePeers(peers)
	})

	return e
}

// SetPeerTLS configures mTLS for peer replication using the given certificate and CA pool.
// The same certificate is used for both client (dialing peers) and server (accepting peers).
func (e *Engine) SetPeerTLS(cert tls.Certificate, caPool *x509.CertPool) {
	e.peerCert = cert
	e.peerCAPool = caPool
	e.tlsEnabled = true
}

// Start begins the replication engine.
func (e *Engine) Start() {
	go e.connectLoop()
}

// Stop halts the replication engine and closes all peer connections.
func (e *Engine) Stop() {
	close(e.stopCh)
	e.mu.Lock()
	defer e.mu.Unlock()
	for _, pc := range e.peers {
		pc.mu.Lock()
		if pc.conn != nil {
			pc.conn.Close()
		}
		pc.mu.Unlock()
	}
}

// NextTimestamp returns the next logical timestamp for conflict resolution.
func (e *Engine) NextTimestamp() uint64 {
	return e.logicalClock.Add(1)
}

// UpdateClock updates the logical clock if the incoming timestamp is higher.
func (e *Engine) UpdateClock(incoming uint64) {
	for {
		current := e.logicalClock.Load()
		if incoming <= current {
			return
		}
		if e.logicalClock.CompareAndSwap(current, incoming) {
			return
		}
	}
}

// ReplicateKVSet replicates a KV set operation to all peers.
func (e *Engine) ReplicateKVSet(key string, value []byte, ttlMs int64) {
	entry := ReplicationEntry{
		Op:        OpKVSet,
		Key:       key,
		Value:     value,
		TTLMs:     ttlMs,
		Timestamp: e.NextTimestamp(),
	}
	e.broadcast(entry)
}

// ReplicateKVDelete replicates a KV delete operation to all peers.
func (e *Engine) ReplicateKVDelete(key string) {
	entry := ReplicationEntry{
		Op:        OpKVDelete,
		Key:       key,
		Timestamp: e.NextTimestamp(),
	}
	e.broadcast(entry)
}

// ReplicatePubSub replicates a pub/sub message to all peers.
func (e *Engine) ReplicatePubSub(channel string, message []byte) {
	entry := ReplicationEntry{
		Op:        OpPubSub,
		Channel:   channel,
		Message:   message,
		Timestamp: e.NextTimestamp(),
	}
	e.broadcast(entry)
}

// HandleIncoming processes a replication entry received from a peer.
func (e *Engine) HandleIncoming(entry ReplicationEntry) {
	e.UpdateClock(entry.Timestamp)

	switch entry.Op {
	case OpKVSet:
		if e.OnKVSet != nil {
			e.OnKVSet(entry.Key, entry.Value, entry.TTLMs, entry.Timestamp)
		}
	case OpKVDelete:
		if e.OnKVDelete != nil {
			e.OnKVDelete(entry.Key, entry.Timestamp)
		}
	case OpPubSub:
		if e.OnPubSub != nil {
			e.OnPubSub(entry.Channel, entry.Message)
		}
	}
}

// broadcast sends a replication entry to all known peers.
// In sync mode, blocks until at least one peer ACKs or timeout.
func (e *Engine) broadcast(entry ReplicationEntry) {
	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("[replication] marshal error: %v", err)
		return
	}

	// Pre-build the newline-terminated message (shared read-only across peers).
	msg := make([]byte, len(data)+1)
	copy(msg, data)
	msg[len(data)] = '\n'

	e.mu.RLock()
	peers := make([]*peerConn, 0, len(e.peers))
	for _, pc := range e.peers {
		peers = append(peers, pc)
	}
	e.mu.RUnlock()

	if len(peers) == 0 {
		return
	}

	if !e.SyncMode {
		// Async: fire-and-forget to all peers.
		for _, pc := range peers {
			e.sendToPeer(pc, msg)
		}
		return
	}

	// Sync mode: send to all peers concurrently, wait for at least one ACK.
	acked := make(chan struct{}, 1)
	for _, pc := range peers {
		go func(pc *peerConn) {
			if e.sendToPeerSync(pc, msg) {
				select {
				case acked <- struct{}{}:
				default:
				}
			}
		}(pc)
	}

	select {
	case <-acked:
		// At least one peer ACKed.
	case <-time.After(ackTimeout):
		log.Printf("[replication] sync: no peer ACK within %v", ackTimeout)
	case <-e.stopCh:
	}
}

// sendToPeer sends a pre-formatted message asynchronously. Buffers if disconnected.
func (e *Engine) sendToPeer(pc *peerConn, msg []byte) {
	pc.mu.Lock()
	defer pc.mu.Unlock()

	if !pc.connected || pc.conn == nil {
		e.bufferEntry(pc, msg)
		return
	}

	if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		pc.connected = false
		e.bufferEntry(pc, msg)
		return
	}

	if _, err := pc.conn.Write(msg); err != nil {
		log.Printf("[replication] write to %s failed: %v", pc.addr, err)
		pc.connected = false
		pc.conn.Close()
		pc.conn = nil
		e.bufferEntry(pc, msg)
	}
}

// sendToPeerSync sends a message and waits for an ACK. Returns true if ACKed.
// Serialized per peer via sendMu to maintain ACK ordering.
func (e *Engine) sendToPeerSync(pc *peerConn, msg []byte) bool {
	pc.sendMu.Lock()
	defer pc.sendMu.Unlock()

	pc.mu.Lock()
	if !pc.connected || pc.conn == nil {
		e.bufferEntry(pc, msg)
		pc.mu.Unlock()
		return false
	}

	if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		pc.connected = false
		e.bufferEntry(pc, msg)
		pc.mu.Unlock()
		return false
	}

	if _, err := pc.conn.Write(msg); err != nil {
		log.Printf("[replication] sync write to %s failed: %v", pc.addr, err)
		pc.connected = false
		pc.conn.Close()
		pc.conn = nil
		e.bufferEntry(pc, msg)
		pc.mu.Unlock()
		return false
	}
	pc.mu.Unlock()

	// Wait for ACK from the reader goroutine.
	select {
	case <-pc.ackCh:
		return true
	case <-time.After(ackTimeout):
		log.Printf("[replication] ACK timeout from peer %s", pc.addr)
		return false
	case <-e.stopCh:
		return false
	}
}

// bufferEntry stores a message for later replay. Drops oldest entries when full.
func (e *Engine) bufferEntry(pc *peerConn, msg []byte) {
	for pc.buffer.Len() >= e.maxBufferEntries {
		front := pc.buffer.Front()
		if front == nil {
			break
		}
		pc.buffer.Remove(front)
		pc.bufferCount--
	}
	// Copy to avoid sharing the backing array across peers.
	entry := make([]byte, len(msg))
	copy(entry, msg)
	pc.buffer.PushBack(entry)
	pc.bufferCount++
}

func (e *Engine) updatePeers(peers []*Peer) {
	e.mu.Lock()
	defer e.mu.Unlock()

	seen := make(map[string]bool)
	for _, p := range peers {
		seen[p.Address] = true
		if _, ok := e.peers[p.Address]; !ok {
			e.peers[p.Address] = &peerConn{
				addr:   p.Address,
				buffer: list.New(),
				ackCh:  make(chan struct{}, 16),
			}
		}
	}

	for addr, pc := range e.peers {
		if !seen[addr] {
			pc.mu.Lock()
			if pc.conn != nil {
				pc.conn.Close()
			}
			pc.mu.Unlock()
			delete(e.peers, addr)
		}
	}
}

func (e *Engine) connectLoop() {
	ticker := time.NewTicker(reconnectInterval)
	defer ticker.Stop()

	for {
		select {
		case <-e.stopCh:
			return
		case <-ticker.C:
			e.reconnectAll()
		}
	}
}

func (e *Engine) reconnectAll() {
	e.mu.RLock()
	peers := make([]*peerConn, 0, len(e.peers))
	for _, pc := range e.peers {
		peers = append(peers, pc)
	}
	e.mu.RUnlock()

	for _, pc := range peers {
		pc.mu.Lock()
		if pc.connected && pc.conn != nil {
			pc.mu.Unlock()
			continue
		}

		conn, err := e.dialPeer(pc.addr)
		if err != nil {
			pc.mu.Unlock()
			continue
		}

		pc.conn = conn
		pc.connected = true
		log.Printf("[replication] connected to peer %s (tls=%v)", pc.addr, e.tlsEnabled)

		// Perform full-state sync: request snapshot from the peer.
		reader, syncErr := e.performOutboundSync(pc)
		if syncErr != nil {
			log.Printf("[replication] sync with %s failed: %v (continuing with buffer replay)", pc.addr, syncErr)
			// If the connection died during sync, skip this peer.
			if pc.conn == nil || !pc.connected {
				pc.mu.Unlock()
				continue
			}
			reader = bufio.NewReaderSize(conn, 64*1024)
		}

		// Replay any entries buffered while the peer was disconnected.
		e.replayBuffer(pc)

		// Start background goroutine to read ACKs (and drain them to prevent TCP backlog).
		e.startAckReader(pc, conn, reader)

		pc.mu.Unlock()
	}
}

// dialPeer connects to a peer, using mTLS if configured.
func (e *Engine) dialPeer(addr string) (net.Conn, error) {
	if !e.tlsEnabled {
		return net.DialTimeout("tcp", addr, 5*time.Second)
	}

	dialer := &net.Dialer{Timeout: 5 * time.Second}
	conn, err := tls.DialWithDialer(dialer, "tcp", addr, e.peerDialTLSConfig())
	if err != nil {
		return nil, fmt.Errorf("tls dial %s: %w", addr, err)
	}

	// Verify peer certificate SPIFFE ID after TLS handshake.
	if e.PeerSPIFFEID != "" {
		state := conn.ConnectionState()
		if len(state.PeerCertificates) == 0 {
			conn.Close()
			return nil, fmt.Errorf("peer %s: no certificate presented", addr)
		}
		actualSPIFFEID, err := spiffeid.ExtractID(state.PeerCertificates[0])
		if err != nil {
			conn.Close()
			return nil, fmt.Errorf("peer %s: %w", addr, err)
		}
		if !spiffeid.Equal(actualSPIFFEID, e.PeerSPIFFEID) {
			conn.Close()
			return nil, fmt.Errorf("peer %s: SPIFFE ID %q does not match required %q", addr, actualSPIFFEID, e.PeerSPIFFEID)
		}
	}

	return conn, nil
}

// performOutboundSync sends a sync request and applies the snapshot response.
// Caller must hold pc.mu.
func (e *Engine) performOutboundSync(pc *peerConn) (*bufio.Reader, error) {
	// Send sync request with our current logical clock.
	req := ReplicationEntry{
		Op:        OpSyncReq,
		Timestamp: e.logicalClock.Load(),
	}
	data, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("marshal sync request: %w", err)
	}
	reqMsg := make([]byte, len(data)+1)
	copy(reqMsg, data)
	reqMsg[len(data)] = '\n'

	if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		return nil, fmt.Errorf("set write deadline: %w", err)
	}
	if _, err := pc.conn.Write(reqMsg); err != nil {
		return nil, fmt.Errorf("send sync request: %w", err)
	}

	// Read snapshot entries until OpSyncDone.
	reader := bufio.NewReaderSize(pc.conn, 64*1024)
	count := 0
	for {
		if err := pc.conn.SetReadDeadline(time.Now().Add(syncReadTimeout)); err != nil {
			return reader, fmt.Errorf("set read deadline: %w", err)
		}
		line, err := reader.ReadBytes('\n')
		if err != nil {
			return reader, fmt.Errorf("read sync response: %w", err)
		}

		var entry ReplicationEntry
		if err := json.Unmarshal(trimNewline(line), &entry); err != nil {
			return reader, fmt.Errorf("unmarshal sync entry: %w", err)
		}

		if entry.Op == OpSyncDone {
			break
		}

		// Apply snapshot entry locally.
		e.HandleIncoming(entry)
		count++
	}

	log.Printf("[replication] sync from %s: received %d entries", pc.addr, count)
	return reader, nil
}

func (e *Engine) replayBuffer(pc *peerConn) {
	replayed := 0
	for pc.buffer.Len() > 0 {
		front := pc.buffer.Front()
		if front == nil {
			break
		}
		msg := pc.buffer.Remove(front).([]byte)
		pc.bufferCount--

		if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
			pc.connected = false
			pc.buffer.PushFront(msg)
			pc.bufferCount++
			log.Printf("[replication] partial replay to %s: %d entries, %d remaining",
				pc.addr, replayed, pc.buffer.Len())
			return
		}
		if _, err := pc.conn.Write(msg); err != nil {
			log.Printf("[replication] replay to %s failed: %v", pc.addr, err)
			pc.connected = false
			pc.conn.Close()
			pc.conn = nil
			pc.buffer.PushFront(msg)
			pc.bufferCount++
			return
		}
		replayed++
	}
	if replayed > 0 {
		log.Printf("[replication] buffer replayed to %s: %d entries", pc.addr, replayed)
	}
}

// startAckReader runs a goroutine that reads ACK messages from a peer connection.
// It signals pc.ackCh for each ACK, enabling sync-mode flow control.
// In async mode the ACKs are still read to prevent TCP send-buffer backlog on the receiver.
func (e *Engine) startAckReader(pc *peerConn, conn net.Conn, reader *bufio.Reader) {
	go func() {
		defer func() {
			// Mark disconnected so the reconnect loop re-establishes the connection.
			pc.mu.Lock()
			if pc.connected {
				pc.connected = false
				if pc.conn != nil {
					pc.conn.Close()
					pc.conn = nil
				}
			}
			pc.mu.Unlock()
		}()

		for {
			if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
				return
			}
			line, err := reader.ReadBytes('\n')
			if err != nil {
				// Distinguish timeout (idle) from real error.
				if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
					// No data — peer is alive but idle. Keep reading.
					continue
				}
				return
			}

			var msg ReplicationEntry
			if err := json.Unmarshal(trimNewline(line), &msg); err != nil {
				continue
			}

			if msg.Op == OpAck {
				select {
				case pc.ackCh <- struct{}{}:
				default:
				}
			}
		}
	}()
}

// --- TLS helpers ---

// peerDialTLSConfig builds a TLS config for outbound peer connections.
// InsecureSkipVerify is true because hostname/IP may not match cert SANs in dynamic
// environments. Chain verification is done manually in VerifyPeerCertificate; SPIFFE
// ID verification is done after the handshake in dialPeer.
func (e *Engine) peerDialTLSConfig() *tls.Config {
	caPool := e.peerCAPool
	return &tls.Config{
		Certificates:       []tls.Certificate{e.peerCert},
		RootCAs:            caPool,
		InsecureSkipVerify: true, //nolint:gosec // manual chain verification below
		VerifyPeerCertificate: func(rawCerts [][]byte, _ [][]*x509.Certificate) error {
			if len(rawCerts) == 0 {
				return fmt.Errorf("peer presented no certificate")
			}
			certs := make([]*x509.Certificate, len(rawCerts))
			for i, raw := range rawCerts {
				c, err := x509.ParseCertificate(raw)
				if err != nil {
					return fmt.Errorf("parse peer cert: %w", err)
				}
				certs[i] = c
			}
			opts := x509.VerifyOptions{
				Roots:         caPool,
				Intermediates: x509.NewCertPool(),
				KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
			}
			for _, c := range certs[1:] {
				opts.Intermediates.AddCert(c)
			}
			if _, err := certs[0].Verify(opts); err != nil {
				return fmt.Errorf("peer certificate chain verification failed: %w", err)
			}
			return nil
		},
		MinVersion: tls.VersionTLS12,
	}
}

// peerListenTLSConfig builds a TLS config for the inbound replication listener.
// Standard TLS library verifies the client cert chain against ClientCAs.
// VerifyPeerCertificate adds SPIFFE ID enforcement.
func (e *Engine) peerListenTLSConfig() *tls.Config {
	cfg := &tls.Config{
		Certificates: []tls.Certificate{e.peerCert},
		ClientAuth:   tls.RequireAndVerifyClientCert,
		ClientCAs:    e.peerCAPool,
		MinVersion:   tls.VersionTLS12,
	}
	if e.PeerSPIFFEID != "" {
		expectedSPIFFEID := e.PeerSPIFFEID
		cfg.VerifyPeerCertificate = func(_ [][]byte, verifiedChains [][]*x509.Certificate) error {
			if len(verifiedChains) == 0 || len(verifiedChains[0]) == 0 {
				return fmt.Errorf("no verified peer certificate chain")
			}
			actualSPIFFEID, err := spiffeid.ExtractID(verifiedChains[0][0])
			if err != nil {
				return err
			}
			if !spiffeid.Equal(actualSPIFFEID, expectedSPIFFEID) {
				return fmt.Errorf("peer SPIFFE ID %q does not match required %q", actualSPIFFEID, expectedSPIFFEID)
			}
			return nil
		}
	}
	return cfg
}

// --- Replication listener ---

// ListenForReplication starts a listener that accepts incoming replication connections.
// When the engine has TLS configured, connections are secured with mTLS and CN verification.
func ListenForReplication(addr string, engine *Engine) (net.Listener, error) {
	var ln net.Listener
	var err error

	if engine.tlsEnabled {
		ln, err = tls.Listen("tcp", addr, engine.peerListenTLSConfig())
		if err != nil {
			return nil, fmt.Errorf("replication tls listen: %w", err)
		}
		log.Printf("[replication] listener using mTLS (SPIFFE ID=%q)", engine.PeerSPIFFEID)
	} else {
		ln, err = net.Listen("tcp", addr)
		if err != nil {
			return nil, fmt.Errorf("replication listen: %w", err)
		}
		log.Println("[replication] listener using INSECURE plaintext")
	}

	go func() {
		for {
			conn, acceptErr := ln.Accept()
			if acceptErr != nil {
				select {
				case <-engine.stopCh:
					return
				default:
					log.Printf("[replication] accept error: %v", acceptErr)
					continue
				}
			}

			// Explicit TLS handshake + SPIFFE ID check for inbound connections.
			if engine.tlsEnabled && engine.PeerSPIFFEID != "" {
				if tlsConn, ok := conn.(*tls.Conn); ok {
					if hsErr := tlsConn.Handshake(); hsErr != nil {
						log.Printf("[replication] TLS handshake from %s failed: %v", conn.RemoteAddr(), hsErr)
						conn.Close()
						continue
					}
					state := tlsConn.ConnectionState()
					if len(state.PeerCertificates) > 0 {
						actualSPIFFEID, err := spiffeid.ExtractID(state.PeerCertificates[0])
						if err != nil || !spiffeid.Equal(actualSPIFFEID, engine.PeerSPIFFEID) {
							log.Printf("[replication] rejected peer SPIFFE ID=%q from %s (required=%q)",
								actualSPIFFEID, conn.RemoteAddr(), engine.PeerSPIFFEID)
							conn.Close()
							continue
						}
					}
				}
			}

			go handleReplicationConn(conn, engine)
		}
	}()

	return ln, nil
}

// handleReplicationConn processes an inbound replication connection.
// Protocol:
//  1. First message may be OpSyncReq — triggers snapshot transfer
//  2. Normal receive loop: process entries, send ACKs
func handleReplicationConn(conn net.Conn, engine *Engine) {
	defer conn.Close()

	reader := bufio.NewReaderSize(conn, 64*1024)
	sendAcks := false

	// Read first message — may be a sync request from the new protocol.
	if err := conn.SetReadDeadline(time.Now().Add(syncReadTimeout)); err != nil {
		return
	}
	firstLine, err := reader.ReadBytes('\n')
	if err != nil {
		return
	}

	var firstMsg ReplicationEntry
	if err := json.Unmarshal(trimNewline(firstLine), &firstMsg); err != nil {
		log.Printf("[replication] unmarshal error from %s: %v", conn.RemoteAddr(), err)
		return
	}

	if firstMsg.Op == OpSyncReq {
		sendAcks = true
		log.Printf("[replication] sync request from %s (clock=%d)", conn.RemoteAddr(), firstMsg.Timestamp)

		// Send full-state snapshot.
		if engine.SnapshotProvider != nil {
			entries := engine.SnapshotProvider()
			for _, entry := range entries {
				data, marshalErr := json.Marshal(entry)
				if marshalErr != nil {
					continue
				}
				entryMsg := make([]byte, len(data)+1)
				copy(entryMsg, data)
				entryMsg[len(data)] = '\n'
				if wdErr := conn.SetWriteDeadline(time.Now().Add(writeTimeout)); wdErr != nil {
					log.Printf("[replication] snapshot write deadline error: %v", wdErr)
					return
				}
				if _, wErr := conn.Write(entryMsg); wErr != nil {
					log.Printf("[replication] snapshot write to %s failed: %v", conn.RemoteAddr(), wErr)
					return
				}
			}
			log.Printf("[replication] snapshot sent to %s: %d entries", conn.RemoteAddr(), len(entries))
		}

		// Send sync-done marker.
		done := ReplicationEntry{Op: OpSyncDone}
		doneData, _ := json.Marshal(done)
		doneMsg := make([]byte, len(doneData)+1)
		copy(doneMsg, doneData)
		doneMsg[len(doneData)] = '\n'
		if err := conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
			return
		}
		if _, err := conn.Write(doneMsg); err != nil {
			return
		}
	} else {
		// Not a sync request — process as a normal replication entry (backward compat).
		engine.HandleIncoming(firstMsg)
	}

	// Normal receive loop.
	for {
		if err := conn.SetReadDeadline(time.Now().Add(30 * time.Second)); err != nil {
			return
		}
		line, err := reader.ReadBytes('\n')
		if err != nil {
			if netErr, ok := err.(net.Error); ok && netErr.Timeout() {
				continue // Idle timeout — keep listening.
			}
			return
		}

		if len(line) > maxLineLength {
			log.Printf("[replication] closing connection from %s: line exceeds %d bytes", conn.RemoteAddr(), maxLineLength)
			return
		}

		var entry ReplicationEntry
		if err := json.Unmarshal(trimNewline(line), &entry); err != nil {
			log.Printf("[replication] unmarshal error: %v", err)
			continue
		}

		engine.HandleIncoming(entry)

		// Send ACK if this connection started with a sync handshake.
		if sendAcks {
			ack := ReplicationEntry{Op: OpAck, Timestamp: entry.Timestamp}
			ackData, _ := json.Marshal(ack)
			ackMsg := make([]byte, len(ackData)+1)
			copy(ackMsg, ackData)
			ackMsg[len(ackData)] = '\n'
			if err := conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
				return
			}
			if _, err := conn.Write(ackMsg); err != nil {
				return
			}
		}
	}
}

// trimNewline strips trailing CR/LF from a line returned by ReadBytes.
func trimNewline(b []byte) []byte {
	for len(b) > 0 && (b[len(b)-1] == '\n' || b[len(b)-1] == '\r') {
		b = b[:len(b)-1]
	}
	return b
}
