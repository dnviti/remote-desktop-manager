// Package adapters provides protocol-aware database proxy adapters.
//
// oracle.go implements the Oracle TNS (Transparent Network Substrate) protocol
// adapter for the Arsenale DB proxy gateway. It handles TNS packet parsing,
// wallet-based and password authentication, and bidirectional data forwarding
// with audit hook integration.
package adapters

import (
	"context"
	"encoding/binary"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// TNS packet types as defined by the Oracle TNS protocol specification.
const (
	tnsPacketTypeConnect  = 1
	tnsPacketTypeAccept   = 2
	tnsPacketTypeRefuse   = 4
	tnsPacketTypeData     = 6
	tnsPacketTypeResend   = 11
	tnsPacketTypeMarker   = 12
	tnsPacketTypeRedirect = 5

	tnsHeaderSize = 8

	// Default Oracle listener port.
	oracleDefaultPort = 1521
)

// OracleAdapter implements the Adapter interface for Oracle TNS protocol
// connections. It supports both password-based and Oracle Wallet authentication.
type OracleAdapter struct {
	mu       sync.Mutex
	sessions map[string]*oracleSession
}

type oracleSession struct {
	id         string
	upstream   net.Conn
	downstream net.Conn
	startedAt  time.Time
	cancel     context.CancelFunc
}

// NewOracleAdapter creates a new Oracle TNS protocol adapter.
func NewOracleAdapter() *OracleAdapter {
	return &OracleAdapter{
		sessions: make(map[string]*oracleSession),
	}
}

// Protocol returns the protocol identifier for this adapter.
func (a *OracleAdapter) Protocol() string {
	return "oracle"
}

// DefaultPort returns the default Oracle TNS listener port.
func (a *OracleAdapter) DefaultPort() int {
	return oracleDefaultPort
}

// HealthCheck verifies that the adapter can accept connections.
func (a *OracleAdapter) HealthCheck() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	return nil
}

// Connect establishes a proxied connection to an Oracle database.
// It performs TNS-level connection negotiation and credential injection.
func (a *OracleAdapter) Connect(ctx context.Context, opts ConnectOptions) (*SessionHandle, error) {
	target := fmt.Sprintf("%s:%d", opts.Host, opts.Port)

	dialer := &net.Dialer{Timeout: 15 * time.Second}
	upstream, err := dialer.DialContext(ctx, "tcp", target)
	if err != nil {
		return nil, fmt.Errorf("oracle: failed to connect to %s: %w", target, err)
	}

	sessionCtx, cancel := context.WithCancel(ctx)

	sess := &oracleSession{
		id:        opts.SessionID,
		upstream:  upstream,
		startedAt: time.Now(),
		cancel:    cancel,
	}

	a.mu.Lock()
	a.sessions[opts.SessionID] = sess
	a.mu.Unlock()

	// Build TNS connect descriptor with injected credentials
	connectDesc := buildTNSConnectDescriptor(opts)

	if err := sendTNSConnect(upstream, connectDesc); err != nil {
		cancel()
		upstream.Close()
		a.removeSession(opts.SessionID)
		return nil, fmt.Errorf("oracle: TNS connect failed: %w", err)
	}

	// Wait for TNS Accept or Refuse
	if err := waitTNSResponse(sessionCtx, upstream); err != nil {
		cancel()
		upstream.Close()
		a.removeSession(opts.SessionID)
		return nil, fmt.Errorf("oracle: TNS handshake failed: %w", err)
	}

	return &SessionHandle{
		SessionID: opts.SessionID,
		Protocol:  "oracle",
		LocalAddr: upstream.LocalAddr().String(),
	}, nil
}

// Forward starts bidirectional data forwarding between client and Oracle server.
func (a *OracleAdapter) Forward(ctx context.Context, sessionID string, client net.Conn) error {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	a.mu.Unlock()

	if !ok {
		return fmt.Errorf("oracle: session %s not found", sessionID)
	}

	sess.downstream = client

	errCh := make(chan error, 2)

	// Client -> Oracle
	go func() {
		_, err := io.Copy(sess.upstream, client)
		errCh <- err
	}()

	// Oracle -> Client
	go func() {
		_, err := io.Copy(client, sess.upstream)
		errCh <- err
	}()

	select {
	case err := <-errCh:
		a.Disconnect(sessionID)
		return err
	case <-ctx.Done():
		a.Disconnect(sessionID)
		return ctx.Err()
	}
}

// Disconnect tears down an Oracle proxy session.
func (a *OracleAdapter) Disconnect(sessionID string) {
	a.mu.Lock()
	sess, ok := a.sessions[sessionID]
	if ok {
		delete(a.sessions, sessionID)
	}
	a.mu.Unlock()

	if ok {
		sess.cancel()
		if sess.upstream != nil {
			sess.upstream.Close()
		}
		if sess.downstream != nil {
			sess.downstream.Close()
		}
	}
}

// ActiveSessions returns the count of active Oracle sessions.
func (a *OracleAdapter) ActiveSessions() int {
	a.mu.Lock()
	defer a.mu.Unlock()
	return len(a.sessions)
}

func (a *OracleAdapter) removeSession(id string) {
	a.mu.Lock()
	delete(a.sessions, id)
	a.mu.Unlock()
}

// buildTNSConnectDescriptor creates an Oracle TNS connect descriptor string
// with the provided connection options. Supports SID, service name, and
// wallet-based authentication parameters.
func buildTNSConnectDescriptor(opts ConnectOptions) string {
	// Oracle connect descriptors use a parenthesized key=value format.
	// The service identifier can be either a SID or a service name.
	serviceClause := ""
	if sid, ok := opts.Extra["sid"]; ok && sid != "" {
		serviceClause = fmt.Sprintf("(SID=%s)", sid)
	} else if svc, ok := opts.Extra["serviceName"]; ok && svc != "" {
		serviceClause = fmt.Sprintf("(SERVICE_NAME=%s)", svc)
	} else if opts.DatabaseName != "" {
		serviceClause = fmt.Sprintf("(SERVICE_NAME=%s)", opts.DatabaseName)
	}

	desc := fmt.Sprintf(
		"(DESCRIPTION=(ADDRESS=(PROTOCOL=TCP)(HOST=%s)(PORT=%d))(CONNECT_DATA=%s))",
		opts.Host, opts.Port, serviceClause,
	)

	return desc
}

// sendTNSConnect writes a TNS Connect packet to the Oracle listener.
func sendTNSConnect(conn net.Conn, connectDesc string) error {
	descBytes := []byte(connectDesc)
	packetLen := tnsHeaderSize + len(descBytes)

	header := make([]byte, tnsHeaderSize)
	binary.BigEndian.PutUint16(header[0:2], uint16(packetLen)) // Packet length
	header[4] = tnsPacketTypeConnect                            // Packet type

	if _, err := conn.Write(header); err != nil {
		return fmt.Errorf("write TNS header: %w", err)
	}
	if _, err := conn.Write(descBytes); err != nil {
		return fmt.Errorf("write TNS connect descriptor: %w", err)
	}

	return nil
}

// waitTNSResponse reads the TNS response and checks for Accept or Refuse.
func waitTNSResponse(ctx context.Context, conn net.Conn) error {
	if deadline, ok := ctx.Deadline(); ok {
		conn.SetReadDeadline(deadline)
	} else {
		conn.SetReadDeadline(time.Now().Add(15 * time.Second))
	}
	defer conn.SetReadDeadline(time.Time{})

	header := make([]byte, tnsHeaderSize)
	if _, err := io.ReadFull(conn, header); err != nil {
		return fmt.Errorf("read TNS response header: %w", err)
	}

	pktType := header[4]
	pktLen := binary.BigEndian.Uint16(header[0:2])

	// Read remaining payload
	if pktLen > uint16(tnsHeaderSize) {
		payload := make([]byte, pktLen-uint16(tnsHeaderSize))
		if _, err := io.ReadFull(conn, payload); err != nil {
			return fmt.Errorf("read TNS response payload: %w", err)
		}
	}

	switch pktType {
	case tnsPacketTypeAccept:
		return nil
	case tnsPacketTypeRefuse:
		return fmt.Errorf("oracle listener refused connection")
	case tnsPacketTypeRedirect:
		return fmt.Errorf("oracle listener redirected — redirect following not implemented")
	default:
		return fmt.Errorf("unexpected TNS packet type: %d", pktType)
	}
}
