package main

import (
	"fmt"
	"io"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
	"github.com/gorilla/websocket"
)

type sendFrameFunc func(conn *websocket.Conn, frameType byte, streamID uint16, payload []byte) error

type Forwarder struct {
	mu      sync.Mutex
	sockets map[uint16]net.Conn
}

func NewForwarder() *Forwarder {
	return &Forwarder{sockets: make(map[uint16]net.Conn)}
}

func (f *Forwarder) HandleOpen(conn *websocket.Conn, streamID uint16, payload []byte, send sendFrameFunc) {
	target := string(payload)
	host, port, ok := parseTarget(target)
	if !ok {
		f.warn("OPEN frame for stream %d has invalid target: %q", streamID, target)
		_ = send(conn, protocol.MsgClose, streamID, nil)
		return
	}
	if port < 1 || port > 65535 {
		f.warn("OPEN frame for stream %d has invalid port: %q", streamID, target)
		_ = send(conn, protocol.MsgClose, streamID, nil)
		return
	}
	if !isAllowedLocalHost(host) {
		f.warn("OPEN frame for stream %d rejected: non-localhost host %q is not allowed", streamID, host)
		_ = send(conn, protocol.MsgClose, streamID, nil)
		return
	}

	f.log("Opening local TCP connection to %s:%d for stream %d", host, port, streamID)
	localConn, err := net.Dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		f.warn("TCP socket error for stream %d: %v", streamID, err)
		_ = send(conn, protocol.MsgClose, streamID, nil)
		return
	}

	f.mu.Lock()
	if previous := f.sockets[streamID]; previous != nil {
		_ = previous.Close()
	}
	f.sockets[streamID] = localConn
	f.mu.Unlock()

	if err := send(conn, protocol.MsgOpen, streamID, nil); err != nil {
		f.remove(streamID)
		_ = localConn.Close()
		return
	}
	f.log("Stream %d connected to %s:%d", streamID, host, port)
	go f.copyLocalToTunnel(conn, streamID, localConn, send)
}

func (f *Forwarder) HandleData(streamID uint16, payload []byte) {
	localConn := f.lookup(streamID)
	if localConn == nil {
		f.warn("DATA frame for unknown stream %d - ignoring", streamID)
		return
	}
	if _, err := localConn.Write(payload); err != nil {
		f.warn("TCP socket error for stream %d: %v", streamID, err)
		f.removeAndClose(streamID)
	}
}

func (f *Forwarder) HandleClose(streamID uint16) {
	f.removeAndClose(streamID)
}

func (f *Forwarder) DestroyAll() {
	f.mu.Lock()
	sockets := f.sockets
	f.sockets = make(map[uint16]net.Conn)
	f.mu.Unlock()
	for _, conn := range sockets {
		_ = conn.Close()
	}
}

func (f *Forwarder) ActiveStreamCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sockets)
}

func (f *Forwarder) copyLocalToTunnel(conn *websocket.Conn, streamID uint16, localConn net.Conn, send sendFrameFunc) {
	buf := make([]byte, 32*1024)
	for {
		n, err := localConn.Read(buf)
		if n > 0 {
			if sendErr := send(conn, protocol.MsgData, streamID, buf[:n]); sendErr != nil {
				f.removeAndClose(streamID)
				return
			}
		}
		if err != nil {
			if err != io.EOF {
				f.warn("TCP socket error for stream %d: %v", streamID, err)
			}
			if f.remove(streamID) != nil {
				_ = send(conn, protocol.MsgClose, streamID, nil)
			}
			_ = localConn.Close()
			return
		}
	}
}

func (f *Forwarder) lookup(streamID uint16) net.Conn {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.sockets[streamID]
}

func (f *Forwarder) remove(streamID uint16) net.Conn {
	f.mu.Lock()
	defer f.mu.Unlock()
	conn := f.sockets[streamID]
	delete(f.sockets, streamID)
	return conn
}

func (f *Forwarder) removeAndClose(streamID uint16) {
	if conn := f.remove(streamID); conn != nil {
		_ = conn.Close()
	}
}

func parseTarget(target string) (string, int, bool) {
	if host, portValue, err := net.SplitHostPort(target); err == nil {
		port, err := strconv.Atoi(portValue)
		if err != nil {
			return host, 0, true
		}
		return host, port, true
	}

	idx := strings.LastIndex(target, ":")
	if idx < 0 {
		return "", 0, false
	}
	host := target[:idx]
	port, err := strconv.Atoi(target[idx+1:])
	if err != nil {
		return host, 0, true
	}
	return host, port, true
}

func isAllowedLocalHost(host string) bool {
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func (f *Forwarder) log(format string, args ...any) {
	fmt.Fprintf(os.Stdout, "[tunnel-agent] "+format+"\n", args...)
}

func (f *Forwarder) warn(format string, args ...any) {
	fmt.Fprintf(os.Stderr, "[tunnel-agent] WARN "+format+"\n", args...)
}
