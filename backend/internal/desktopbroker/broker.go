package desktopbroker

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type BrokerConfig struct {
	GuacamoleSecret  string
	DefaultGuacdHost string
	DefaultGuacdPort int
	GuacdTLS         bool
	GuacdCAPath      string
	SessionStore     SessionStore
	Logger           *slog.Logger
}

type Broker struct {
	config   BrokerConfig
	upgrader websocket.Upgrader
}

func NewBroker(config BrokerConfig) *Broker {
	if config.DefaultGuacdHost == "" {
		config.DefaultGuacdHost = "guacd"
	}
	if config.DefaultGuacdPort == 0 {
		config.DefaultGuacdPort = 4822
	}
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
			Subprotocols: []string{"guacamole"},
		},
	}
}

func (b *Broker) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	tokenValue := r.URL.Query().Get("token")
	if tokenValue == "" {
		http.Error(w, "missing token", http.StatusBadRequest)
		return
	}

	wsConn, err := b.upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	token, err := DecryptToken(b.config.GuacamoleSecret, tokenValue)
	if err != nil {
		b.sendClientError(wsConn, "Token validation failed", "INVALID_TOKEN")
		_ = wsConn.Close()
		return
	}

	settings, err := CompileSettings(token)
	if err != nil {
		b.sendClientError(wsConn, "Connection configuration error", "CONFIG_ERROR")
		_ = wsConn.Close()
		return
	}

	guacdHost := token.Connection.GuacdHost
	if guacdHost == "" {
		guacdHost = b.config.DefaultGuacdHost
	}
	guacdPort := token.Connection.GuacdPort
	if guacdPort == 0 {
		guacdPort = b.config.DefaultGuacdPort
	}

	guacdConn, err := b.connectGuacd(guacdHost, guacdPort)
	if err != nil {
		b.config.Logger.Warn("connect guacd failed", "host", guacdHost, "port", guacdPort, "error", err)
		b.sendClientError(wsConn, mapGuacdError(err), "SERVICE_UNAVAILABLE")
		_ = wsConn.Close()
		return
	}

	session := &guacSession{
		logger:       b.config.Logger.With("component", "desktop-broker", "protocol", settings.Selector),
		wsConn:       wsConn,
		guacdConn:    guacdConn,
		settings:     settings,
		sessionStore: b.config.SessionStore,
		tokenHash:    HashToken(tokenValue),
		recordingID:  MetadataString(token.Metadata, "recordingId"),
	}

	session.run(r.Context())
}

func (b *Broker) connectGuacd(host string, port int) (net.Conn, error) {
	address := net.JoinHostPort(host, fmt.Sprintf("%d", port))
	dialer := &net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}
	if !b.config.GuacdTLS {
		return dialer.Dial("tcp", address)
	}

	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}
	if b.config.GuacdCAPath != "" {
		caPEM, err := os.ReadFile(b.config.GuacdCAPath)
		if err != nil {
			return nil, fmt.Errorf("read guacd ca: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caPEM) {
			return nil, errors.New("failed to append guacd ca certificate")
		}
		// Tunnel mode proxies the guacd TLS session through the Node server, so
		// the TCP dial target can be "server" while the certificate still belongs
		// to the remote guacd endpoint. Verify the chain against our CA and skip
		// hostname binding at this layer.
		tlsConfig.InsecureSkipVerify = true
		tlsConfig.VerifyConnection = func(state tls.ConnectionState) error {
			if len(state.PeerCertificates) == 0 {
				return errors.New("guacd did not present a certificate")
			}

			opts := x509.VerifyOptions{
				Roots:         pool,
				CurrentTime:   time.Now(),
				Intermediates: x509.NewCertPool(),
			}
			for _, cert := range state.PeerCertificates[1:] {
				opts.Intermediates.AddCert(cert)
			}

			if _, err := state.PeerCertificates[0].Verify(opts); err != nil {
				return fmt.Errorf("verify guacd certificate chain: %w", err)
			}
			return nil
		}
	} else {
		tlsConfig.InsecureSkipVerify = true
	}

	return tls.DialWithDialer(dialer, "tcp", address, tlsConfig)
}

func (b *Broker) sendClientError(conn *websocket.Conn, message, code string) {
	_ = conn.WriteMessage(websocket.TextMessage, []byte(EncodeInstruction("error", message, code)))
}

type guacSession struct {
	logger       *slog.Logger
	wsConn       *websocket.Conn
	guacdConn    net.Conn
	settings     CompiledSettings
	sessionStore SessionStore
	tokenHash    string
	recordingID  string

	wsWriteMu    sync.Mutex
	guacdWriteMu sync.Mutex
	bufferMu     sync.Mutex
	pending      [][]byte
	ready        bool
	closeOnce    sync.Once
	closed       chan struct{}
}

func (s *guacSession) run(ctx context.Context) {
	s.closed = make(chan struct{})

	if err := s.writeGuacd([]byte(EncodeInstruction("select", s.settings.Selector))); err != nil {
		s.sendErrorAndClose("Desktop service unavailable", "SERVICE_UNAVAILABLE")
		s.finalize()
		return
	}

	go s.readWebSocket()
	s.readGuacd()
	s.finalize()

	select {
	case <-ctx.Done():
	case <-s.closed:
	}
}

func (s *guacSession) readWebSocket() {
	for {
		messageType, payload, err := s.wsConn.ReadMessage()
		if err != nil {
			s.closeAll()
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		s.bufferMu.Lock()
		if s.ready {
			s.bufferMu.Unlock()
			if err := s.writeGuacd(payload); err != nil {
				s.sendErrorAndClose("Desktop connection failed", "CONNECTION_ERROR")
				return
			}
			continue
		}
		s.pending = append(s.pending, append([]byte(nil), payload...))
		s.bufferMu.Unlock()
	}
}

func (s *guacSession) readGuacd() {
	decoder := &Decoder{}
	buffer := make([]byte, 8192)
	for {
		n, err := s.guacdConn.Read(buffer)
		if n > 0 {
			instructions, decodeErr := decoder.Feed(buffer[:n])
			if decodeErr != nil {
				s.sendErrorAndClose("Desktop connection failed", "PROTOCOL_ERROR")
				return
			}
			for _, instruction := range instructions {
				if err := s.handleGuacdInstruction(instruction); err != nil {
					s.sendErrorAndClose("Desktop connection failed", "CONNECTION_ERROR")
					return
				}
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.logger.Warn("guacd read error", "error", err)
			}
			s.closeAll()
			return
		}
	}
}

func (s *guacSession) handleGuacdInstruction(instruction []string) error {
	if len(instruction) == 0 {
		return nil
	}

	switch instruction[0] {
	case "args":
		messages, err := BuildHandshakeMessages(s.settings, instruction[1:])
		if err != nil {
			return err
		}
		for _, message := range messages {
			if err := s.writeGuacd([]byte(message)); err != nil {
				return err
			}
		}
		return nil
	case "ready":
		readyPayload := ""
		if len(instruction) > 1 {
			readyPayload = instruction[1]
		}
		s.bufferMu.Lock()
		s.ready = true
		pending := s.pending
		s.pending = nil
		s.bufferMu.Unlock()

		if err := s.writeWebSocket(EncodeInstruction("ready", readyPayload)); err != nil {
			return err
		}
		for _, message := range pending {
			if err := s.writeGuacd(message); err != nil {
				return err
			}
		}
		return nil
	case "error":
		if err := s.writeWebSocket(EncodeInstruction(instruction...)); err != nil {
			return err
		}
		s.closeAll()
		return nil
	default:
		return s.writeWebSocket(EncodeInstruction(instruction...))
	}
}

func (s *guacSession) writeGuacd(payload []byte) error {
	s.guacdWriteMu.Lock()
	defer s.guacdWriteMu.Unlock()
	_, err := s.guacdConn.Write(payload)
	return err
}

func (s *guacSession) writeWebSocket(message string) error {
	s.wsWriteMu.Lock()
	defer s.wsWriteMu.Unlock()
	return s.wsConn.WriteMessage(websocket.TextMessage, []byte(message))
}

func (s *guacSession) sendErrorAndClose(message, code string) {
	_ = s.writeWebSocket(EncodeInstruction("error", message, code))
	s.closeAll()
}

func (s *guacSession) finalize() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.sessionStore.FinalizeDesktopSession(ctx, s.tokenHash, s.recordingID); err != nil {
		s.logger.Warn("finalize desktop session", "error", err)
	}
}

func (s *guacSession) closeAll() {
	s.closeOnce.Do(func() {
		close(s.closed)
		_ = s.guacdConn.Close()
		_ = s.wsConn.Close()
	})
}

func mapGuacdError(err error) string {
	message := strings.ToLower(err.Error())
	switch {
	case strings.Contains(message, "refused"):
		return "Desktop service unavailable"
	case strings.Contains(message, "timeout"):
		return "Desktop connection timeout"
	default:
		return "Desktop connection failed"
	}
}
