package sshsessions

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type sessionLifecycleStore interface {
	StartSession(context.Context, sessions.StartSessionParams) (string, error)
	EndOwnedSession(context.Context, string, string, string) error
	HeartbeatOwnedSession(context.Context, string, string) error
}

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	SessionStore        sessionLifecycleStore
	TenantAuth          tenantauth.Service
	ServerEncryptionKey []byte
	TerminalBrokerURL   string
	TunnelBrokerURL     string
	HTTPClient          *http.Client
	RecordingPath       string
	RecordingEnabled    bool
}

type createRequest struct {
	ConnectionID   string `json:"connectionId"`
	Username       string `json:"username,omitempty"`
	Password       string `json:"password,omitempty"`
	Domain         string `json:"domain,omitempty"`
	CredentialMode string `json:"credentialMode,omitempty"`
}

type createResponse struct {
	Transport            string         `json:"transport"`
	SessionID            string         `json:"sessionId"`
	Token                string         `json:"token"`
	ExpiresAt            time.Time      `json:"expiresAt"`
	WebSocketPath        string         `json:"webSocketPath"`
	WebSocketURL         string         `json:"webSocketUrl"`
	DLPPolicy            resolvedDLP    `json:"dlpPolicy"`
	EnforcedSSHSettings  map[string]any `json:"enforcedSshSettings"`
	SFTPSupported        bool           `json:"sftpSupported"`
	FileBrowserSupported bool           `json:"fileBrowserSupported"`
}

type coreResult struct {
	SessionID           string
	Token               string
	ExpiresAt           time.Time
	DLPPolicy           resolvedDLP
	EnforcedSSHSettings map[string]any
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func (e *requestError) StatusCode() int {
	return e.status
}

type connectionAccess struct {
	Connection connectionRecord
	AccessType string
}

type connectionRecord struct {
	ID                      string
	Type                    string
	Host                    string
	Port                    int
	TeamID                  *string
	GatewayID               *string
	CredentialSecretID      *string
	ExternalVaultProviderID *string
	ExternalVaultPath       *string
	TargetDBHost            *string
	TargetDBPort            *int
	DBType                  *string
	DBSettings              json.RawMessage
	DLPPolicy               json.RawMessage
	TransferRetentionPolicy json.RawMessage

	EncryptedUsername *string
	UsernameIV        *string
	UsernameTag       *string
	EncryptedPassword *string
	PasswordIV        *string
	PasswordTag       *string
	EncryptedDomain   *string
	DomainIV          *string
	DomainTag         *string

	SharedEncryptedUsername *string
	SharedUsernameIV        *string
	SharedUsernameTag       *string
	SharedEncryptedPassword *string
	SharedPasswordIV        *string
	SharedPasswordTag       *string
	SharedEncryptedDomain   *string
	SharedDomainIV          *string
	SharedDomainTag         *string
}

type gatewayRecord struct {
	ID                string
	Type              string
	Host              string
	Port              int
	TenantID          string
	IsManaged         bool
	DeploymentMode    string
	TunnelEnabled     bool
	LBStrategy        string
	EncryptedUsername *string
	UsernameIV        *string
	UsernameTag       *string
	EncryptedPassword *string
	PasswordIV        *string
	PasswordTag       *string
	EncryptedSSHKey   *string
	SSHKeyIV          *string
	SSHKeyTag         *string
}

type resolvedCredentials struct {
	Username         string
	Password         string
	Domain           string
	PrivateKey       string
	Passphrase       string
	CredentialSource string
}

type resolvedDLP struct {
	DisableCopy     bool `json:"disableCopy"`
	DisablePaste    bool `json:"disablePaste"`
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type dlpPolicy struct {
	DisableCopy     bool `json:"disableCopy"`
	DisablePaste    bool `json:"disablePaste"`
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type tunnelProxyResponse struct {
	ID        string `json:"id"`
	Host      string `json:"host"`
	Port      int    `json:"port"`
	ExpiresIn int    `json:"expiresInMs,omitempty"`
}

type terminalGrantIssueResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}
