package terminalbroker

import (
	"io"
	"log/slog"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessionrecording"
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
	runtimes *runtimeRegistry
}

type runtimeSession interface {
	StdinPipe() (io.WriteCloser, error)
	StdoutPipe() (io.Reader, error)
	StderrPipe() (io.Reader, error)
	RequestPty(term string, h, w int, modes ssh.TerminalModes) error
	Shell() error
	WindowChange(h, w int) error
	Wait() error
	Close() error
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

type terminalRuntime struct {
	logger       *slog.Logger
	session      runtimeSession
	stdin        io.WriteCloser
	stdout       io.Reader
	stderr       io.Reader
	sessionStore SessionStore
	sessionID    string
	recording    *sessionrecording.Reference
	onClose      func()

	subscribersMu sync.Mutex
	owner         *terminalSubscriber
	observers     map[*terminalSubscriber]struct{}
	recordingMu   sync.Mutex
	closeOnce     sync.Once
	closed        chan struct{}
	outputWG      sync.WaitGroup

	activityMu       sync.Mutex
	lastActivityAt   time.Time
	externalCloseMu  sync.Mutex
	externalCloseSet bool
	pausedMu         sync.Mutex
	paused           bool
}

type terminalSubscriber struct {
	logger      *slog.Logger
	runtime     *terminalRuntime
	wsConn      *websocket.Conn
	mode        contracts.TerminalSessionMode
	ownsRuntime bool
	writeMu     sync.Mutex
	closeOnce   sync.Once
	closed      chan struct{}
}
