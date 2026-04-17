package terminalbroker

import (
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
	"golang.org/x/crypto/ssh"
)

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
		runtimes: newRuntimeRegistry(),
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
		sendSocketErrorAndClose(wsConn, "INVALID_TOKEN", err.Error())
		return
	}
	if grant.Mode == contracts.TerminalSessionModeObserve {
		b.handleObserveWebSocket(wsConn, grant)
		return
	}
	b.handleControlWebSocket(wsConn, grant)
}

func (b *Broker) handleObserveWebSocket(wsConn *websocket.Conn, grant contracts.TerminalSessionGrant) {
	runtime, ok := b.runtimes.get(grant.SessionID)
	if !ok {
		sendSocketErrorAndClose(wsConn, "SESSION_NOT_FOUND", "active SSH session is not available for observation")
		return
	}

	subscriber := newTerminalSubscriber(runtime, wsConn, contracts.TerminalSessionModeObserve, false)
	if !runtime.attachSubscriber(subscriber) {
		sendSocketErrorAndClose(wsConn, "SESSION_NOT_FOUND", "active SSH session is not available for observation")
		return
	}
	if err := subscriber.send(serverMessage{Type: "ready"}); err != nil {
		subscriber.disconnect()
		return
	}

	go subscriber.readWebSocket()
	<-subscriber.closed
}

func (b *Broker) handleControlWebSocket(wsConn *websocket.Conn, grant contracts.TerminalSessionGrant) {
	if _, exists := b.runtimes.get(grant.SessionID); exists {
		sendSocketErrorAndClose(wsConn, "SESSION_ACTIVE", "terminal session is already attached")
		return
	}

	client, cleanup, err := connectSSH(grant)
	if err != nil {
		b.config.Logger.Warn("terminal broker connect failed", "error", err, "host", grant.Target.Host, "port", grant.Target.Port)
		sendSocketErrorAndClose(wsConn, "CONNECTION_ERROR", mapConnectionError(err))
		return
	}
	defer cleanup()

	runtime, socketErr := b.newTerminalRuntime(client, grant)
	if socketErr != nil {
		sendSocketErrorAndClose(wsConn, socketErr.code, socketErr.message)
		return
	}
	runtime.onClose = func() {
		b.runtimes.remove(grant.SessionID, runtime)
	}
	if !b.runtimes.add(grant.SessionID, runtime) {
		_ = runtime.session.Close()
		sendSocketErrorAndClose(wsConn, "SESSION_ACTIVE", "terminal session is already attached")
		return
	}

	subscriber := newTerminalSubscriber(runtime, wsConn, contracts.TerminalSessionModeControl, true)
	if !runtime.attachSubscriber(subscriber) {
		runtime.close()
		sendSocketErrorAndClose(wsConn, "SESSION_ACTIVE", "terminal session is already attached")
		return
	}
	if err := subscriber.send(serverMessage{Type: "ready"}); err != nil {
		runtime.close()
		return
	}

	runtime.outputWG.Add(2)
	go runtime.streamOutput(runtime.stdout)
	go runtime.streamOutput(runtime.stderr)
	go subscriber.readWebSocket()
	go runtime.waitForSession()
	go runtime.monitorSessionState()
	runtime.noteActivity(true)

	<-runtime.closed
}

type socketError struct {
	code    string
	message string
}

func (b *Broker) newTerminalRuntime(client *ssh.Client, grant contracts.TerminalSessionGrant) (*terminalRuntime, *socketError) {
	session, err := client.NewSession()
	if err != nil {
		return nil, &socketError{code: "SESSION_ERROR", message: "failed to create SSH session"}
	}

	stdin, err := session.StdinPipe()
	if err != nil {
		_ = session.Close()
		return nil, &socketError{code: "SESSION_ERROR", message: "failed to open stdin"}
	}
	stdout, err := session.StdoutPipe()
	if err != nil {
		_ = session.Close()
		return nil, &socketError{code: "SESSION_ERROR", message: "failed to open stdout"}
	}
	stderr, err := session.StderrPipe()
	if err != nil {
		_ = session.Close()
		return nil, &socketError{code: "SESSION_ERROR", message: "failed to open stderr"}
	}

	if err := session.RequestPty(
		grant.Terminal.Term,
		grant.Terminal.Rows,
		grant.Terminal.Cols,
		ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 14400, ssh.TTY_OP_OSPEED: 14400},
	); err != nil {
		_ = session.Close()
		return nil, &socketError{code: "PTY_ERROR", message: "failed to request PTY"}
	}
	if err := session.Shell(); err != nil {
		_ = session.Close()
		return nil, &socketError{code: "SHELL_ERROR", message: "failed to start shell"}
	}

	return &terminalRuntime{
		logger:       b.config.Logger.With("component", "terminal-broker", "session_id", grant.SessionID),
		session:      session,
		stdin:        stdin,
		stdout:       stdout,
		stderr:       stderr,
		sessionStore: b.config.SessionStore,
		sessionID:    grant.SessionID,
		recording:    recordingReference(grant.Metadata),
		closed:       make(chan struct{}),
		observers:    make(map[*terminalSubscriber]struct{}),
	}, nil
}
