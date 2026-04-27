package tunnelbroker

import (
	"io"
	"log/slog"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	frameHeaderSize         = 4
	maxFramePayloadSize     = 10 * 1024 * 1024
	maxStreamID             = 0xffff
	defaultOpenTimeout      = 10 * time.Second
	defaultProxyIdleTimeout = 60 * time.Second
	defaultTrustDomain      = "arsenale.local"
	aesKeyBytes             = 32
	aesIVBytes              = 16
)

type msgType byte

const (
	msgOpen      msgType = 1
	msgData      msgType = 2
	msgClose     msgType = 3
	msgPing      msgType = 4
	msgPong      msgType = 5
	msgHeartbeat msgType = 6
	msgCertRenew msgType = 7
)

type HeartbeatMetadata struct {
	Healthy       bool `json:"healthy"`
	LatencyMs     *int `json:"latencyMs,omitempty"`
	ActiveStreams *int `json:"activeStreams,omitempty"`
}

type BrokerConfig struct {
	Store               Store
	Logger              *slog.Logger
	ServerEncryptionKey []byte
	SpiffeTrustDomain   string
	ProxyBindHost       string
	ProxyAdvertiseHost  string
}

type Broker struct {
	config   BrokerConfig
	upgrader websocket.Upgrader

	mu       sync.RWMutex
	registry map[string]*tunnelConnection
}

type tunnelConnection struct {
	broker           *Broker
	gatewayID        string
	ws               *websocket.Conn
	connectedAt      time.Time
	clientVersion    string
	clientIP         string
	lastHeartbeat    time.Time
	lastPingSentAt   time.Time
	pingLatency      *int64
	bytesTransferred int64
	heartbeat        *HeartbeatMetadata

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
