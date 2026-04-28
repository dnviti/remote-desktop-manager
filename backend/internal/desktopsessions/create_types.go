package desktopsessions

import (
	"encoding/json"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessions"
)

type createRequest struct {
	ConnectionID   string `json:"connectionId"`
	Username       string `json:"username,omitempty"`
	Password       string `json:"password,omitempty"`
	Domain         string `json:"domain,omitempty"`
	CredentialMode string `json:"credentialMode,omitempty"`
}

type createResponse struct {
	Token            string      `json:"token"`
	EnableDrive      bool        `json:"enableDrive,omitempty"`
	SessionID        string      `json:"sessionId"`
	RecordingID      string      `json:"recordingId,omitempty"`
	DLPPolicy        resolvedDLP `json:"dlpPolicy"`
	ResolvedUsername string      `json:"resolvedUsername,omitempty"`
	ResolvedDomain   string      `json:"resolvedDomain,omitempty"`
}

type desktopPolicySnapshot struct {
	DLPPolicy        resolvedDLP
	RecordingEnabled bool
	EnforcedSettings *enforcedConnectionSettings
}

type desktopRoute struct {
	GatewayID           string
	InstanceID          string
	GuacdHost           string
	GuacdPort           int
	RoutingDecision     *sessions.RoutingDecision
	RecordingGatewayDir string
}

type desktopConnectionSnapshot struct {
	ID          string
	Type        string
	Host        string
	Port        int
	GatewayID   *string
	EnableDrive bool
	RDPSettings json.RawMessage
	VNCSettings json.RawMessage
	DLPPolicy   json.RawMessage
}

type gatewaySnapshot struct {
	ID             string
	Type           string
	Host           string
	Port           int
	IsManaged      bool
	DeploymentMode string
	TunnelEnabled  bool
	LBStrategy     string
	EgressPolicy   json.RawMessage
}

type managedGatewayInstance struct {
	ID             string
	ContainerName  string
	Host           string
	Port           int
	ActiveSessions int
	CreatedAt      time.Time
}

type sessionErrorContext struct {
	ConnectionID string
	Host         string
	Port         int
	GatewayID    string
}
