package connectionaccess

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type ResolveError struct {
	Status  int
	Message string
}

func (e *ResolveError) Error() string {
	return e.Message
}

type ResolveConnectionOptions struct {
	ExpectedType     string
	OverrideUsername string
	OverridePassword string
	OverrideDomain   string
	CredentialMode   string
}

type ConnectionSnapshot struct {
	ID                      string
	Type                    string
	Host                    string
	Port                    int
	TeamID                  *string
	GatewayID               *string
	TargetDBHost            *string
	TargetDBPort            *int
	DBType                  *string
	DBSettings              json.RawMessage
	DLPPolicy               json.RawMessage
	TransferRetentionPolicy json.RawMessage
}

type ResolvedConnection struct {
	Connection  ConnectionSnapshot
	AccessType  string
	Credentials ResolvedCredentials
}

type ResolvedCredentials struct {
	Username         string
	Password         string
	Domain           string
	PrivateKey       string
	Passphrase       string
	CredentialSource string
}

type ResolvedFileTransferTarget struct {
	Connection ConnectionSnapshot
	AccessType string
	Target     contracts.TerminalEndpoint
	Bastion    *contracts.TerminalEndpoint
}

type Resolver interface {
	ResolveConnection(context.Context, string, string, string, ResolveConnectionOptions) (ResolvedConnection, error)
	CreateTunnelProxy(context.Context, string, string, int) (contracts.TunnelProxyResponse, error)
}

type FileResolver interface {
	Resolver
	ResolveFileTransferTarget(context.Context, string, string, string, ResolveConnectionOptions) (ResolvedFileTransferTarget, error)
}

type HTTPClientProvider interface {
	HTTPClientForConnectionAccess() *http.Client
}
