package dbsessions

import (
	"context"
	"time"

	"github.com/dnviti/arsenale/backend/internal/connectionaccess"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5/pgxpool"
)

type sessionLifecycleStore interface {
	StartSession(context.Context, sessions.StartSessionParams) (string, error)
	LoadOwnedSessionState(context.Context, string, string) (*sessions.SessionState, error)
	UpdateOwnedSessionMetadata(context.Context, string, string, map[string]any) error
	HeartbeatOwnedSession(context.Context, string, string) error
	EndOwnedSession(context.Context, string, string, string) error
}

type SessionIssueRequest struct {
	TenantID        string                    `json:"tenantId,omitempty"`
	UserID          string                    `json:"userId"`
	ConnectionID    string                    `json:"connectionId"`
	GatewayID       string                    `json:"gatewayId,omitempty"`
	InstanceID      string                    `json:"instanceId,omitempty"`
	Protocol        string                    `json:"protocol"`
	IPAddress       string                    `json:"ipAddress,omitempty"`
	Username        string                    `json:"username,omitempty"`
	ProxyHost       string                    `json:"proxyHost"`
	ProxyPort       int                       `json:"proxyPort"`
	DatabaseName    string                    `json:"databaseName,omitempty"`
	SessionMetadata map[string]any            `json:"sessionMetadata,omitempty"`
	RoutingDecision *sessions.RoutingDecision `json:"routingDecision,omitempty"`
	Target          *contracts.DatabaseTarget `json:"target,omitempty"`
}

type SessionIssueResponse struct {
	SessionID    string `json:"sessionId"`
	ProxyHost    string `json:"proxyHost"`
	ProxyPort    int    `json:"proxyPort"`
	Protocol     string `json:"protocol"`
	DatabaseName string `json:"databaseName,omitempty"`
	Username     string `json:"username,omitempty"`
}

type OwnedSessionRequest struct {
	UserID string `json:"userId"`
	Reason string `json:"reason,omitempty"`
}

type SessionConfigRequest struct {
	UserID        string                           `json:"userId"`
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
	Target        *contracts.DatabaseTarget        `json:"target,omitempty"`
}

type ownedSessionConfigPayload struct {
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
	Target        *contracts.DatabaseTarget        `json:"target,omitempty"`
}

type Service struct {
	Store               sessionLifecycleStore
	DB                  *pgxpool.Pool
	TenantAuth          tenantauth.Service
	ConnectionResolver  connectionaccess.Resolver
	ServerEncryptionKey []byte
	RuntimePrincipalKey string
}

type QueryHistoryEntry struct {
	ID              string    `json:"id"`
	QueryText       string    `json:"queryText"`
	QueryType       string    `json:"queryType"`
	ExecutionTimeMS *int      `json:"executionTimeMs"`
	RowsAffected    *int      `json:"rowsAffected"`
	Blocked         bool      `json:"blocked"`
	CreatedAt       time.Time `json:"createdAt"`
	BlockReason     *string   `json:"blockReason,omitempty"`
	ConnectionID    string    `json:"connectionId"`
	TenantID        *string   `json:"tenantId,omitempty"`
}
