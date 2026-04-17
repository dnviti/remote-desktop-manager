package contracts

import "time"

type TerminalSessionMode string

const (
	TerminalSessionModeControl TerminalSessionMode = "control"
	TerminalSessionModeObserve TerminalSessionMode = "observe"
)

type TerminalEndpoint struct {
	Host       string `json:"host"`
	Port       int    `json:"port"`
	Username   string `json:"username"`
	Password   string `json:"password,omitempty"`
	PrivateKey string `json:"privateKey,omitempty"`
	Passphrase string `json:"passphrase,omitempty"`
}

type TerminalSettings struct {
	Term string `json:"term,omitempty"`
	Cols int    `json:"cols,omitempty"`
	Rows int    `json:"rows,omitempty"`
}

type TerminalSessionGrant struct {
	Mode         TerminalSessionMode `json:"mode,omitempty"`
	SessionID    string              `json:"sessionId,omitempty"`
	ConnectionID string              `json:"connectionId,omitempty"`
	UserID       string              `json:"userId,omitempty"`
	ExpiresAt    time.Time           `json:"expiresAt"`
	Target       TerminalEndpoint    `json:"target"`
	Bastion      *TerminalEndpoint   `json:"bastion,omitempty"`
	Terminal     TerminalSettings    `json:"terminal,omitempty"`
	Metadata     map[string]string   `json:"metadata,omitempty"`
}

type TerminalSessionGrantIssueRequest struct {
	Grant TerminalSessionGrant `json:"grant"`
}

type TerminalSessionGrantIssueResponse struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expiresAt"`
}

type TerminalEndpointSummary struct {
	Host          string `json:"host"`
	Port          int    `json:"port"`
	Username      string `json:"username"`
	HasPassword   bool   `json:"hasPassword"`
	HasPrivateKey bool   `json:"hasPrivateKey"`
}

type TerminalSessionGrantSummary struct {
	Mode         TerminalSessionMode      `json:"mode,omitempty"`
	SessionID    string                   `json:"sessionId,omitempty"`
	ConnectionID string                   `json:"connectionId,omitempty"`
	UserID       string                   `json:"userId,omitempty"`
	ExpiresAt    time.Time                `json:"expiresAt"`
	Target       TerminalEndpointSummary  `json:"target"`
	Bastion      *TerminalEndpointSummary `json:"bastion,omitempty"`
	Terminal     TerminalSettings         `json:"terminal,omitempty"`
	Metadata     map[string]string        `json:"metadata,omitempty"`
}

type TerminalSessionGrantValidateRequest struct {
	Token string `json:"token"`
}

type TerminalSessionGrantValidateResponse struct {
	Valid bool                        `json:"valid"`
	Grant TerminalSessionGrantSummary `json:"grant,omitempty"`
	Error string                      `json:"error,omitempty"`
}

type TerminalProtocolDescriptor struct {
	WebSocketPath   string           `json:"webSocketPath"`
	ClientMessages  []string         `json:"clientMessages"`
	ServerMessages  []string         `json:"serverMessages"`
	DefaultTerminal TerminalSettings `json:"defaultTerminal"`
}
