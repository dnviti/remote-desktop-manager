// Package peer - replication engine for cross-peer KV, PubSub, and lock state.
package peer

import (
	"container/list"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"sync"
	"sync/atomic"
	"time"
)

const (
	maxBufferBytes     = 10 * 1024 * 1024 // 10MB per peer
	reconnectInterval  = 2 * time.Second
	writeTimeout       = 5 * time.Second
)

// ReplicationOp is the type of operation to replicate.
type ReplicationOp int

const (
	OpKVSet ReplicationOp = iota + 1
	OpKVDelete
	OpPubSub
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
	addr        string
	conn        net.Conn
	connected   bool
	buffer      *list.List
	bufferBytes int
}

// Engine handles replication to all peers.
type Engine struct {
	registry       *Registry
	mu             sync.RWMutex
	peers          map[string]*peerConn
	logicalClock   atomic.Uint64
	maxBufferBytes int
	stopCh         chan struct{}

	// Callbacks for applying replicated operations locally.
	OnKVSet    func(key string, value []byte, ttlMs int64, timestamp uint64)
	OnKVDelete func(key string, timestamp uint64)
	OnPubSub   func(channel string, message []byte)
}

// NewEngine creates a new replication Engine.
func NewEngine(registry *Registry, maxBuffer int) *Engine {
	if maxBuffer <= 0 {
		maxBuffer = maxBufferBytes
	}
	e := &Engine{
		registry:       registry,
		peers:          make(map[string]*peerConn),
		maxBufferBytes: maxBuffer,
		stopCh:         make(chan struct{}),
	}

	// Listen for peer list changes.
	registry.OnUpdate(func(peers []*Peer) {
		e.updatePeers(peers)
	})

	return e
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

func (e *Engine) broadcast(entry ReplicationEntry) {
	e.mu.RLock()
	defer e.mu.RUnlock()

	data, err := json.Marshal(entry)
	if err != nil {
		log.Printf("[replication] marshal error: %v", err)
		return
	}

	for _, pc := range e.peers {
		go e.sendToPeer(pc, data)
	}
}

func (e *Engine) sendToPeer(pc *peerConn, data []byte) {
	pc.mu.Lock()
	defer pc.mu.Unlock()

	if !pc.connected || pc.conn == nil {
		// Buffer for later replay.
		e.bufferEntry(pc, data)
		return
	}

	if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
		pc.connected = false
		e.bufferEntry(pc, data)
		return
	}

	// Write newline-delimited JSON.
	msg := make([]byte, len(data)+1)
	copy(msg, data)
	msg[len(data)] = '\n'
	if _, err := pc.conn.Write(msg); err != nil {
		log.Printf("[replication] write to %s failed: %v", pc.addr, err)
		pc.connected = false
		pc.conn.Close()
		pc.conn = nil
		e.bufferEntry(pc, data)
	}
}

func (e *Engine) bufferEntry(pc *peerConn, data []byte) {
	if pc.bufferBytes+len(data) > e.maxBufferBytes {
		// Drop oldest to make room.
		for pc.buffer.Len() > 0 && pc.bufferBytes+len(data) > e.maxBufferBytes {
			front := pc.buffer.Front()
			if front != nil {
				old := pc.buffer.Remove(front).([]byte)
				pc.bufferBytes -= len(old)
			}
		}
	}
	pc.buffer.PushBack(data)
	pc.bufferBytes += len(data)
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

		conn, err := net.DialTimeout("tcp", pc.addr, 5*time.Second)
		if err != nil {
			pc.mu.Unlock()
			continue
		}

		pc.conn = conn
		pc.connected = true
		log.Printf("[replication] connected to peer %s", pc.addr)

		// Replay buffer.
		e.replayBuffer(pc)
		pc.mu.Unlock()
	}
}

func (e *Engine) replayBuffer(pc *peerConn) {
	for pc.buffer.Len() > 0 {
		front := pc.buffer.Front()
		if front == nil {
			break
		}
		data := pc.buffer.Remove(front).([]byte)
		pc.bufferBytes -= len(data)

		msg := make([]byte, len(data)+1)
		copy(msg, data)
		msg[len(data)] = '\n'
		if err := pc.conn.SetWriteDeadline(time.Now().Add(writeTimeout)); err != nil {
			pc.connected = false
			// Re-buffer remaining entries (they're still in the list).
			pc.buffer.PushFront(data)
			pc.bufferBytes += len(data)
			return
		}
		if _, err := pc.conn.Write(msg); err != nil {
			log.Printf("[replication] replay to %s failed: %v", pc.addr, err)
			pc.connected = false
			pc.conn.Close()
			pc.conn = nil
			pc.buffer.PushFront(data)
			pc.bufferBytes += len(data)
			return
		}
	}
	if pc.buffer.Len() == 0 {
		log.Printf("[replication] buffer replayed to %s (%d bytes)", pc.addr, 0)
	} else {
		log.Printf("[replication] partial replay to %s, %d entries remaining", pc.addr, pc.buffer.Len())
	}
}

// ListenForReplication starts a TCP listener that accepts incoming replication connections.
func ListenForReplication(addr string, engine *Engine) (net.Listener, error) {
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return nil, fmt.Errorf("replication listen: %w", err)
	}

	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				select {
				case <-engine.stopCh:
					return
				default:
					log.Printf("[replication] accept error: %v", err)
					continue
				}
			}
			go handleReplicationConn(conn, engine)
		}
	}()

	return ln, nil
}

const maxLineLength = 1 << 20 // 1MB max line length to prevent OOM

func handleReplicationConn(conn net.Conn, engine *Engine) {
	defer conn.Close()

	buf := make([]byte, 0, 4096)
	tmp := make([]byte, 4096)

	for {
		n, err := conn.Read(tmp)
		if err != nil {
			return
		}
		buf = append(buf, tmp[:n]...)

		// Guard against unbounded buffer growth from peers sending data without newlines.
		if len(buf) > maxLineLength {
			log.Printf("[replication] closing connection: line exceeds %d bytes", maxLineLength)
			return
		}

		// Process complete lines (newline-delimited JSON).
		for {
			idx := -1
			for i, b := range buf {
				if b == '\n' {
					idx = i
					break
				}
			}
			if idx < 0 {
				break
			}

			line := buf[:idx]
			buf = buf[idx+1:]

			var entry ReplicationEntry
			if err := json.Unmarshal(line, &entry); err != nil {
				log.Printf("[replication] unmarshal error: %v", err)
				continue
			}
			engine.HandleIncoming(entry)
		}
	}
}
