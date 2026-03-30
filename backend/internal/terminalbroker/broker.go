package terminalbroker

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

type BrokerConfig struct {
	Secret       string
	SessionStore SessionStore
	Logger       *slog.Logger
}

type Broker struct {
	config   BrokerConfig
	upgrader websocket.Upgrader
}

type clientMessage struct {
	Type string `json:"type"`
	Data string `json:"data,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

type serverMessage struct {
	Type    string `json:"type"`
	Data    string `json:"data,omitempty"`
	Code    string `json:"code,omitempty"`
	Message string `json:"message,omitempty"`
}

func NewBroker(config BrokerConfig) *Broker {
	if config.SessionStore == nil {
		config.SessionStore = NoopSessionStore{}
	}
	if config.Logger == nil {
		config.Logger = slog.Default()
	}
	return &Broker{
		config: config,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(*http.Request) bool { return true },
		},
	}
}

func (b *Broker) HandleGrantIssue(w http.ResponseWriter, r *http.Request) {
	var req contracts.TerminalSessionGrantIssueRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	token, err := IssueGrant(b.config.Secret, req.Grant)
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	normalized, err := ValidateGrant(b.config.Secret, token, time.Now().UTC())
	if err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}

	writeJSON(w, http.StatusOK, contracts.TerminalSessionGrantIssueResponse{
		Token:     token,
		ExpiresAt: normalized.ExpiresAt,
	})
}

func (b *Broker) HandleGrantValidate(w http.ResponseWriter, r *http.Request) {
	var req contracts.TerminalSessionGrantValidateRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, fmt.Sprintf(`{"error":"%s"}`, err.Error()), http.StatusBadRequest)
		return
	}
	grant, err := ValidateGrant(b.config.Secret, req.Token, time.Now().UTC())
	if err != nil {
		writeJSON(w, http.StatusBadRequest, contracts.TerminalSessionGrantValidateResponse{
			Valid: false,
			Error: err.Error(),
		})
		return
	}
	writeJSON(w, http.StatusOK, contracts.TerminalSessionGrantValidateResponse{
		Valid: true,
		Grant: DescribeGrant(grant),
	})
}

func (b *Broker) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	token := strings.TrimSpace(r.URL.Query().Get("token"))
	if token == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}

	wsConn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	grant, err := ValidateGrant(b.config.Secret, token, time.Now().UTC())
	if err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "INVALID_TOKEN", Message: err.Error()})
		_ = wsConn.Close()
		return
	}

	client, cleanup, err := connectSSH(grant)
	if err != nil {
		b.config.Logger.Warn("terminal broker connect failed", "error", err, "host", grant.Target.Host, "port", grant.Target.Port)
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "CONNECTION_ERROR", Message: mapConnectionError(err)})
		_ = wsConn.Close()
		return
	}
	defer cleanup()

	session, err := client.NewSession()
	if err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "SESSION_ERROR", Message: "failed to create SSH session"})
		_ = wsConn.Close()
		return
	}
	defer session.Close()

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "SESSION_ERROR", Message: "failed to open stdin"})
		_ = wsConn.Close()
		return
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "SESSION_ERROR", Message: "failed to open stdout"})
		_ = wsConn.Close()
		return
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "SESSION_ERROR", Message: "failed to open stderr"})
		_ = wsConn.Close()
		return
	}

	if err := session.RequestPty(
		grant.Terminal.Term,
		grant.Terminal.Rows,
		grant.Terminal.Cols,
		ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400},
	); err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "PTY_ERROR", Message: "failed to request PTY"})
		_ = wsConn.Close()
		return
	}
	if err := session.Shell(); err != nil {
		_ = sendWebsocketMessage(wsConn, serverMessage{Type: "error", Code: "SHELL_ERROR", Message: "failed to start shell"})
		_ = wsConn.Close()
		return
	}

	if err := sendWebsocketMessage(wsConn, serverMessage{Type: "ready"}); err != nil {
		_ = wsConn.Close()
		return
	}

	runtime := &terminalRuntime{
		logger:       b.config.Logger.With("component", "terminal-broker", "session_id", grant.SessionID),
		wsConn:       wsConn,
		session:      session,
		stdin:        stdin,
		sessionStore: b.config.SessionStore,
		sessionID:    grant.SessionID,
		closed:       make(chan struct{}),
	}

	runtime.outputWG.Add(2)
	go runtime.streamOutput(stdout)
	go runtime.streamOutput(stderr)
	go runtime.readWebSocket()
	go runtime.waitForSession()
	go runtime.monitorSessionState()
	runtime.noteActivity(true)

	<-runtime.closed
}

type terminalRuntime struct {
	logger       *slog.Logger
	wsConn       *websocket.Conn
	session      *ssh.Session
	stdin        io.WriteCloser
	sessionStore SessionStore
	sessionID    string

	wsWriteMu sync.Mutex
	closeOnce sync.Once
	closed    chan struct{}
	outputWG  sync.WaitGroup

	activityMu       sync.Mutex
	lastActivityAt   time.Time
	externalCloseMu  sync.Mutex
	externalCloseSet bool
}

func (r *terminalRuntime) readWebSocket() {
	for {
		_, payload, err := r.wsConn.ReadMessage()
		if err != nil {
			r.close()
			return
		}

		var message clientMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			_ = r.send(serverMessage{Type: "error", Code: "PROTOCOL_ERROR", Message: "invalid websocket payload"})
			r.close()
			return
		}

		switch message.Type {
		case "input":
			if _, err := io.WriteString(r.stdin, message.Data); err != nil {
				_ = r.send(serverMessage{Type: "error", Code: "WRITE_ERROR", Message: "failed to send terminal input"})
				r.close()
				return
			}
			r.noteActivity(false)
		case "resize":
			if message.Cols > 0 && message.Rows > 0 {
				_ = r.session.WindowChange(message.Rows, message.Cols)
			}
			r.noteActivity(false)
		case "ping":
			r.noteActivity(true)
			if err := r.send(serverMessage{Type: "pong"}); err != nil {
				r.close()
				return
			}
		case "close":
			r.close()
			return
		default:
			_ = r.send(serverMessage{Type: "error", Code: "PROTOCOL_ERROR", Message: "unsupported terminal message"})
			r.close()
			return
		}
	}
}

func (r *terminalRuntime) streamOutput(reader io.Reader) {
	defer r.outputWG.Done()

	buffer := make([]byte, 8192)
	for {
		n, err := reader.Read(buffer)
		if n > 0 {
			if writeErr := r.send(serverMessage{Type: "data", Data: string(buffer[:n])}); writeErr != nil {
				r.close()
				return
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				r.logger.Warn("terminal stream read error", "error", err)
			}
			return
		}
	}
}

func (r *terminalRuntime) waitForSession() {
	if err := r.session.Wait(); err != nil {
		var exitErr *ssh.ExitError
		if !errors.As(err, &exitErr) {
			_ = r.send(serverMessage{Type: "error", Code: "SESSION_ERROR", Message: "terminal session ended unexpectedly"})
		}
	}

	outputDone := make(chan struct{})
	go func() {
		r.outputWG.Wait()
		close(outputDone)
	}()

	select {
	case <-outputDone:
	case <-time.After(250 * time.Millisecond):
	}

	r.close()
}

func (r *terminalRuntime) monitorSessionState() {
	if r.sessionID == "" {
		return
	}

	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.closed:
			return
		case <-ticker.C:
			state, err := r.sessionStore.GetTerminalSessionState(context.Background(), r.sessionID)
			if err != nil {
				r.logger.Warn("load terminal session state failed", "error", err)
				continue
			}
			if !state.Exists || !state.Closed {
				continue
			}

			r.markExternalClose()
			switch state.Reason {
			case "admin_terminated":
				_ = r.send(serverMessage{Type: "error", Code: "SESSION_TERMINATED", Message: "Session terminated by administrator"})
			case "timeout":
				_ = r.send(serverMessage{Type: "error", Code: "SESSION_TIMEOUT", Message: "Session expired due to inactivity"})
			default:
				_ = r.send(serverMessage{Type: "error", Code: "SESSION_CLOSED", Message: "Session closed"})
			}
			r.close()
			return
		}
	}
}

func (r *terminalRuntime) send(message serverMessage) error {
	r.wsWriteMu.Lock()
	defer r.wsWriteMu.Unlock()
	return sendWebsocketMessage(r.wsConn, message)
}

func (r *terminalRuntime) close() {
	r.closeOnce.Do(func() {
		_ = r.stdin.Close()
		_ = r.session.Close()
		_ = r.send(serverMessage{Type: "closed"})
		_ = r.wsConn.Close()
		if !r.wasExternallyClosed() {
			if err := r.sessionStore.FinalizeTerminalSession(context.Background(), r.sessionID); err != nil {
				r.logger.Warn("finalize terminal session failed", "error", err)
			}
		}
		close(r.closed)
	})
}

func (r *terminalRuntime) noteActivity(force bool) {
	if r.sessionID == "" {
		return
	}

	r.activityMu.Lock()
	now := time.Now().UTC()
	if !force && !r.lastActivityAt.IsZero() && now.Sub(r.lastActivityAt) < 10*time.Second {
		r.activityMu.Unlock()
		return
	}
	r.lastActivityAt = now
	r.activityMu.Unlock()

	if err := r.sessionStore.HeartbeatTerminalSession(context.Background(), r.sessionID); err != nil {
		r.logger.Warn("terminal session heartbeat failed", "error", err)
	}
}

func (r *terminalRuntime) markExternalClose() {
	r.externalCloseMu.Lock()
	r.externalCloseSet = true
	r.externalCloseMu.Unlock()
}

func (r *terminalRuntime) wasExternallyClosed() bool {
	r.externalCloseMu.Lock()
	defer r.externalCloseMu.Unlock()
	return r.externalCloseSet
}

func connectSSH(grant contracts.TerminalSessionGrant) (*ssh.Client, func(), error) {
	targetConfig, err := sshClientConfig(grant.Target)
	if err != nil {
		return nil, nil, err
	}

	targetAddr := net.JoinHostPort(grant.Target.Host, strconv.Itoa(grant.Target.Port))
	if grant.Bastion == nil {
		client, err := ssh.Dial("tcp", targetAddr, targetConfig)
		if err != nil {
			return nil, nil, err
		}
		return client, func() { _ = client.Close() }, nil
	}

	bastionConfig, err := sshClientConfig(*grant.Bastion)
	if err != nil {
		return nil, nil, err
	}
	bastionAddr := net.JoinHostPort(grant.Bastion.Host, strconv.Itoa(grant.Bastion.Port))

	bastionClient, err := ssh.Dial("tcp", bastionAddr, bastionConfig)
	if err != nil {
		return nil, nil, err
	}

	tunnelConn, err := bastionClient.Dial("tcp", targetAddr)
	if err != nil {
		_ = bastionClient.Close()
		return nil, nil, err
	}

	conn, chans, reqs, err := ssh.NewClientConn(tunnelConn, targetAddr, targetConfig)
	if err != nil {
		_ = tunnelConn.Close()
		_ = bastionClient.Close()
		return nil, nil, err
	}

	client := ssh.NewClient(conn, chans, reqs)
	return client, func() {
		_ = client.Close()
		_ = bastionClient.Close()
	}, nil
}

func sshClientConfig(endpoint contracts.TerminalEndpoint) (*ssh.ClientConfig, error) {
	authMethods := make([]ssh.AuthMethod, 0, 2)
	if strings.TrimSpace(endpoint.Password) != "" {
		authMethods = append(authMethods, ssh.Password(endpoint.Password))
	}
	if strings.TrimSpace(endpoint.PrivateKey) != "" {
		var (
			signer ssh.Signer
			err    error
		)
		if strings.TrimSpace(endpoint.Passphrase) != "" {
			signer, err = ssh.ParsePrivateKeyWithPassphrase([]byte(endpoint.PrivateKey), []byte(endpoint.Passphrase))
		} else {
			signer, err = ssh.ParsePrivateKey([]byte(endpoint.PrivateKey))
		}
		if err != nil {
			return nil, fmt.Errorf("parse private key for %s@%s: %w", endpoint.Username, endpoint.Host, err)
		}
		authMethods = append(authMethods, ssh.PublicKeys(signer))
	}
	if len(authMethods) == 0 {
		return nil, errors.New("ssh credentials are required")
	}

	return &ssh.ClientConfig{
		User:            endpoint.Username,
		Auth:            authMethods,
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		Timeout:         10 * time.Second,
	}, nil
}

func mapConnectionError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "unable to authenticate"), strings.Contains(message, "permission denied"):
		return "authentication failed"
	case strings.Contains(message, "connection refused"):
		return "terminal target refused the connection"
	case strings.Contains(message, "i/o timeout"), strings.Contains(message, "deadline exceeded"):
		return "terminal target timed out"
	default:
		return "terminal connection failed"
	}
}

func sendWebsocketMessage(conn *websocket.Conn, message serverMessage) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return conn.WriteMessage(websocket.TextMessage, payload)
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}
