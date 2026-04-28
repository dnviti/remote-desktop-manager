package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
)

type frameSender interface {
	SendFrame(frameType byte, streamID uint16, payload []byte) error
	Ready() bool
}

type dialContextFunc func(context.Context, string, string) (net.Conn, error)

type tcpForwarder struct {
	sender      frameSender
	logger      *agentLogger
	dial        dialContextFunc
	allowedHost string
	allowedPort int

	mu      sync.Mutex
	sockets map[uint16]net.Conn
}

func newTCPForwarder(sender frameSender, logger *agentLogger, allowedHost string, allowedPort int) *tcpForwarder {
	dialer := &net.Dialer{Timeout: 10 * time.Second}
	return &tcpForwarder{
		sender:      sender,
		logger:      logger,
		dial:        dialer.DialContext,
		allowedHost: strings.TrimSpace(allowedHost),
		allowedPort: allowedPort,
		sockets:     make(map[uint16]net.Conn),
	}
}

func (f *tcpForwarder) handleOpenFrame(streamID uint16, payload []byte) {
	host, port, ok := parseOpenTarget(string(payload))
	if !ok {
		f.warn("OPEN frame for stream %d has invalid target: %q", streamID, string(payload))
		_ = f.sender.SendFrame(msgClose, streamID, nil)
		return
	}
	if !isLocalhostTarget(host) {
		f.warn("OPEN frame for stream %d rejected: non-localhost host %q is not allowed", streamID, host)
		_ = f.sender.SendFrame(msgClose, streamID, nil)
		return
	}
	if host != f.allowedHost || port != f.allowedPort {
		f.warn("OPEN frame for stream %d rejected: target %s:%d does not match configured local service %s:%d", streamID, host, port, f.allowedHost, f.allowedPort)
		_ = f.sender.SendFrame(msgClose, streamID, nil)
		return
	}

	go f.openLocalSocket(streamID, host, port)
}

func (f *tcpForwarder) openLocalSocket(streamID uint16, host string, port int) {
	address := net.JoinHostPort(host, strconv.Itoa(port))
	f.log("Opening local TCP connection to %s:%d for stream %d", host, port, streamID)

	conn, err := f.dial(context.Background(), "tcp", address)
	if err != nil {
		f.warn("TCP socket error for stream %d: %v", streamID, err)
		_ = f.sender.SendFrame(msgClose, streamID, nil)
		return
	}

	f.mu.Lock()
	if existing := f.sockets[streamID]; existing != nil {
		_ = existing.Close()
	}
	f.sockets[streamID] = conn
	f.mu.Unlock()

	if err := f.sender.SendFrame(msgOpen, streamID, nil); err != nil {
		f.removeSocket(streamID, conn, false)
		_ = conn.Close()
		return
	}

	f.log("Stream %d connected to %s:%d", streamID, host, port)
	f.readLoop(streamID, conn)
}

func (f *tcpForwarder) readLoop(streamID uint16, conn net.Conn) {
	buf := make([]byte, 32*1024)
	for {
		n, readErr := conn.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			if !f.sender.Ready() {
				f.removeSocket(streamID, conn, false)
				_ = conn.Close()
				return
			}
			if err := f.sender.SendFrame(msgData, streamID, chunk); err != nil {
				f.removeSocket(streamID, conn, false)
				_ = conn.Close()
				return
			}
		}
		if readErr != nil {
			if !errors.Is(readErr, net.ErrClosed) && !errors.Is(readErr, io.EOF) {
				f.warn("TCP socket error for stream %d: %v", streamID, readErr)
			}
			f.removeSocket(streamID, conn, true)
			return
		}
	}
}

func (f *tcpForwarder) handleDataFrame(streamID uint16, payload []byte) {
	f.mu.Lock()
	conn := f.sockets[streamID]
	f.mu.Unlock()
	if conn == nil {
		f.warn("DATA frame for unknown stream %d - ignoring", streamID)
		return
	}
	if err := writeFull(conn, payload); err != nil {
		f.warn("TCP socket error for stream %d: %v", streamID, err)
		f.removeSocket(streamID, conn, true)
		_ = conn.Close()
	}
}

func (f *tcpForwarder) handleCloseFrame(streamID uint16) {
	f.mu.Lock()
	conn := f.sockets[streamID]
	if conn != nil {
		delete(f.sockets, streamID)
	}
	f.mu.Unlock()
	if conn != nil {
		_ = conn.Close()
	}
}

func (f *tcpForwarder) destroyAllSockets() {
	f.mu.Lock()
	sockets := f.sockets
	f.sockets = make(map[uint16]net.Conn)
	f.mu.Unlock()

	for _, conn := range sockets {
		_ = conn.Close()
	}
}

func (f *tcpForwarder) activeStreamCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.sockets)
}

func (f *tcpForwarder) removeSocket(streamID uint16, conn net.Conn, sendClose bool) {
	f.mu.Lock()
	current := f.sockets[streamID]
	if current == conn {
		delete(f.sockets, streamID)
	}
	f.mu.Unlock()

	if current == conn {
		_ = conn.Close()
		if sendClose && f.sender.Ready() {
			_ = f.sender.SendFrame(msgClose, streamID, nil)
		}
	}
}

func parseOpenTarget(target string) (string, int, bool) {
	lastColon := strings.LastIndex(target, ":")
	if lastColon == -1 {
		return "", 0, false
	}
	host := target[:lastColon]
	port, err := parsePort(target[lastColon+1:])
	if err != nil {
		return "", 0, false
	}
	return host, port, true
}

func isLocalhostTarget(host string) bool {
	switch host {
	case "localhost", "127.0.0.1", "::1":
		return true
	default:
		return false
	}
}

func writeFull(conn net.Conn, payload []byte) error {
	for len(payload) > 0 {
		n, err := conn.Write(payload)
		if err != nil {
			return err
		}
		if n == 0 {
			return fmt.Errorf("short write")
		}
		payload = payload[n:]
	}
	return nil
}

func (f *tcpForwarder) log(format string, args ...any) {
	if f.logger != nil {
		f.logger.log(format, args...)
	}
}

func (f *tcpForwarder) warn(format string, args ...any) {
	if f.logger != nil {
		f.logger.warn(format, args...)
	}
}
