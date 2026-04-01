package sshsessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	SessionStore        *sessions.Store
	TenantAuth          tenantauth.Service
	ServerEncryptionKey []byte
	TerminalBrokerURL   string
	TunnelBrokerURL     string
	HTTPClient          *http.Client
}

type createRequest struct {
	ConnectionID   string `json:"connectionId"`
	Username       string `json:"username,omitempty"`
	Password       string `json:"password,omitempty"`
	Domain         string `json:"domain,omitempty"`
	CredentialMode string `json:"credentialMode,omitempty"`
}

type createResponse struct {
	Transport           string         `json:"transport"`
	SessionID           string         `json:"sessionId"`
	Token               string         `json:"token"`
	ExpiresAt           time.Time      `json:"expiresAt"`
	WebSocketPath       string         `json:"webSocketPath"`
	WebSocketURL        string         `json:"webSocketUrl"`
	DLPPolicy           resolvedDLP    `json:"dlpPolicy"`
	EnforcedSSHSettings map[string]any `json:"enforcedSshSettings"`
	SFTPSupported       bool           `json:"sftpSupported"`
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

func (s Service) StartSession(ctx context.Context, claims authn.Claims, payload createRequest, ipAddress string) (coreResult, error) {
	if s.DB == nil || s.SessionStore == nil {
		return coreResult{}, fmt.Errorf("database session dependencies are unavailable")
	}

	payload.ConnectionID = strings.TrimSpace(payload.ConnectionID)
	payload.Username = strings.TrimSpace(payload.Username)
	payload.CredentialMode = normalizeCredentialMode(payload.CredentialMode)
	if payload.ConnectionID == "" {
		return coreResult{}, &requestError{status: http.StatusBadRequest, message: "connectionId is required"}
	}
	if payload.CredentialMode != "domain" {
		if (payload.Username == "") != (payload.Password == "") {
			return coreResult{}, &requestError{status: http.StatusBadRequest, message: "Both username and password must be provided together"}
		}
	}

	if claims.TenantID != "" {
		membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
		if err != nil {
			return coreResult{}, fmt.Errorf("resolve tenant membership: %w", err)
		}
		if membership == nil || !membership.Permissions[tenantauth.CanConnect] {
			return coreResult{}, &requestError{status: http.StatusForbidden, message: "Not allowed to start sessions in this tenant"}
		}
	}

	allowed, err := s.checkLateralMovement(ctx, claims.UserID, payload.ConnectionID, ipAddress)
	if err != nil {
		return coreResult{}, err
	}
	if !allowed {
		return coreResult{}, &requestError{
			status:  http.StatusForbidden,
			message: "Session denied: anomalous lateral movement detected. Your account has been temporarily suspended.",
		}
	}

	access, err := s.loadAccess(ctx, claims.UserID, claims.TenantID, payload.ConnectionID)
	if err != nil {
		return coreResult{}, err
	}
	if !strings.EqualFold(access.Connection.Type, "SSH") {
		return coreResult{}, &requestError{status: http.StatusBadRequest, message: "Not an SSH connection"}
	}

	policies, err := s.loadPolicySnapshot(ctx, claims.TenantID, access.Connection.DLPPolicy)
	if err != nil {
		return coreResult{}, err
	}

	credentials, err := s.resolveCredentials(ctx, claims.UserID, claims.TenantID, payload, access)
	if err != nil {
		return coreResult{}, err
	}

	bastion, gatewayID, instanceID, err := s.resolveBastion(ctx, claims, access)
	if err != nil {
		return coreResult{}, err
	}

	if _, err := s.SessionStore.CloseStaleSessionsForConnection(ctx, claims.UserID, access.Connection.ID, "SSH"); err != nil {
		return coreResult{}, fmt.Errorf("close stale SSH sessions: %w", err)
	}

	sessionID, err := s.SessionStore.StartSession(ctx, sessions.StartSessionParams{
		UserID:       claims.UserID,
		ConnectionID: access.Connection.ID,
		GatewayID:    gatewayID,
		InstanceID:   instanceID,
		Protocol:     "SSH",
		IPAddress:    ipAddress,
		Metadata: map[string]any{
			"host":             access.Connection.Host,
			"port":             access.Connection.Port,
			"credentialSource": credentials.CredentialSource,
			"transport":        "terminal-broker",
		},
	})
	if err != nil {
		return coreResult{}, fmt.Errorf("start SSH session: %w", err)
	}

	target := map[string]any{
		"host":     access.Connection.Host,
		"port":     access.Connection.Port,
		"username": credentials.Username,
	}
	if credentials.Password != "" {
		target["password"] = credentials.Password
	}
	if credentials.PrivateKey != "" {
		target["privateKey"] = credentials.PrivateKey
	}
	if credentials.Passphrase != "" {
		target["passphrase"] = credentials.Passphrase
	}

	grant := map[string]any{
		"sessionId":    sessionID,
		"connectionId": access.Connection.ID,
		"userId":       claims.UserID,
		"target":       target,
		"terminal": map[string]any{
			"term": "xterm-256color",
			"cols": 80,
			"rows": 24,
		},
		"metadata": map[string]string{
			"credentialSource": credentials.CredentialSource,
		},
	}
	if bastion != nil {
		grant["bastion"] = bastion
	}

	issued, err := s.issueTerminalGrant(ctx, grant)
	if err != nil {
		_ = s.SessionStore.EndOwnedSession(ctx, sessionID, claims.UserID, "grant_issue_failed")
		return coreResult{}, err
	}

	return coreResult{
		SessionID:           sessionID,
		Token:               issued.Token,
		ExpiresAt:           issued.ExpiresAt,
		DLPPolicy:           policies.DLPPolicy,
		EnforcedSSHSettings: policies.EnforcedSSHSettings,
	}, nil
}

func normalizeCredentialMode(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "domain":
		return "domain"
	case "manual":
		return "manual"
	default:
		return "saved"
	}
}

func (s Service) client() *http.Client {
	if s.HTTPClient != nil {
		return s.HTTPClient
	}
	return &http.Client{Timeout: 15 * time.Second}
}

func defaultTerminalBrokerURL() string {
	if value := strings.TrimSpace(os.Getenv("TERMINAL_BROKER_URL")); value != "" {
		return value
	}
	return "http://terminal-broker-go:8090"
}

func defaultTunnelBrokerURL() string {
	if value := strings.TrimSpace(os.Getenv("GO_TUNNEL_BROKER_URL")); value != "" {
		return value
	}
	if value := strings.TrimSpace(os.Getenv("TUNNEL_BROKER_URL")); value != "" {
		return value
	}
	return "http://tunnel-broker-go:8092"
}

func parseEnvBool(key string, fallback bool) bool {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	switch strings.ToLower(value) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

func parseEnvInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}
