package sessions

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionClosed   = errors.New("session already closed")
)

const MetadataKeyDesktopConnectionID = "guacdConnectionId"

type RoutingDecision struct {
	Strategy             string `json:"strategy,omitempty"`
	CandidateCount       int    `json:"candidateCount,omitempty"`
	SelectedSessionCount int    `json:"selectedSessionCount,omitempty"`
}

type StartSessionParams struct {
	TenantID        string
	UserID          string
	ConnectionID    string
	GatewayID       string
	InstanceID      string
	Protocol        string
	SocketID        string
	GuacTokenHash   string
	IPAddress       string
	Metadata        map[string]any
	RoutingDecision *RoutingDecision
	RecordingID     string
}

type sessionRecord struct {
	ID           string
	UserID       string
	ConnectionID string
	Protocol     string
	GatewayID    *string
	GatewayName  *string
	InstanceID   *string
	IPAddress    *string
	StartedAt    time.Time
	Status       string
}

type SessionState struct {
	Record   sessionRecord
	Metadata map[string]any
}

type SandboxCleanupScope struct {
	TenantID       string
	TenantName     string
	UserID         string
	UserEmail      string
	ConnectionID   string
	ConnectionName string
	Protocol       string
}

type SandboxCleanupHook func(ctx context.Context, scope SandboxCleanupScope) error

var sandboxCleanupHookState struct {
	mu   sync.RWMutex
	hook SandboxCleanupHook
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func RegisterSandboxCleanupHook(hook SandboxCleanupHook) {
	sandboxCleanupHookState.mu.Lock()
	defer sandboxCleanupHookState.mu.Unlock()
	sandboxCleanupHookState.hook = hook
}

func loadSandboxCleanupHook() SandboxCleanupHook {
	sandboxCleanupHookState.mu.RLock()
	defer sandboxCleanupHookState.mu.RUnlock()
	return sandboxCleanupHookState.hook
}

type auditLogParams struct {
	UserID     string
	Action     string
	TargetType string
	TargetID   string
	Details    []byte
	IPAddress  *string
	GatewayID  *string
}
