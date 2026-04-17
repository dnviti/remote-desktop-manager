package desktopbroker

import (
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
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
			CheckOrigin:  func(*http.Request) bool { return true },
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
	if !token.ExpiresAt.IsZero() && !token.ExpiresAt.After(time.Now().UTC()) {
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
		logger:         b.config.Logger.With("component", "desktop-broker", "protocol", settings.Protocol),
		wsConn:         wsConn,
		guacdConn:      guacdConn,
		settings:       settings,
		sessionStore:   b.config.SessionStore,
		tokenHash:      HashToken(tokenValue),
		stateSessionID: MetadataString(token.Metadata, MetadataKeyObserveSessionID),
		recordingID:    MetadataString(token.Metadata, "recordingId"),
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
	logger         *slog.Logger
	wsConn         *websocket.Conn
	guacdConn      net.Conn
	settings       CompiledSettings
	sessionStore   SessionStore
	tokenHash      string
	stateSessionID string
	recordingID    string

	wsWriteMu    sync.Mutex
	guacdWriteMu sync.Mutex
	bufferMu     sync.Mutex
	pending      [][]byte
	ready        bool
	closeOnce    sync.Once
	closed       chan struct{}
	pausedMu     sync.Mutex
	paused       bool
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
