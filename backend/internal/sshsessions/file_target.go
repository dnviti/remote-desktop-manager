package sshsessions

import (
	"context"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func (s Service) ResolveFileTransferTarget(ctx context.Context, userID, tenantID, connectionID string, opts ResolveConnectionOptions) (ResolvedFileTransferTarget, error) {
	access, err := s.loadAccess(ctx, userID, tenantID, strings.TrimSpace(connectionID))
	if err != nil {
		return ResolvedFileTransferTarget{}, mapResolveError(err)
	}
	if !strings.EqualFold(access.Connection.Type, "SSH") {
		return ResolvedFileTransferTarget{}, &ResolveError{
			Status:  http.StatusBadRequest,
			Message: "Not an SSH connection",
		}
	}

	payload := createRequest{
		CredentialMode: normalizeCredentialMode(opts.CredentialMode),
	}
	overrideUsername := strings.TrimSpace(opts.OverrideUsername)
	overridePassword := strings.TrimSpace(opts.OverridePassword)
	if overrideUsername != "" && overridePassword != "" {
		payload.Username = overrideUsername
		payload.Password = overridePassword
		payload.Domain = strings.TrimSpace(opts.OverrideDomain)
	}

	credentials, err := s.resolveCredentials(ctx, userID, tenantID, payload, access)
	if err != nil {
		return ResolvedFileTransferTarget{}, mapResolveError(err)
	}

	bastionMap, _, _, err := s.resolveBastion(ctx, authn.Claims{UserID: userID, TenantID: tenantID}, access)
	if err != nil {
		return ResolvedFileTransferTarget{}, mapResolveError(err)
	}

	target := contracts.TerminalEndpoint{
		Host:       access.Connection.Host,
		Port:       access.Connection.Port,
		Username:   credentials.Username,
		Password:   credentials.Password,
		PrivateKey: credentials.PrivateKey,
		Passphrase: credentials.Passphrase,
	}

	return ResolvedFileTransferTarget{
		Connection: snapshotConnectionRecord(access.Connection),
		AccessType: access.AccessType,
		Target:     target,
		Bastion:    terminalEndpointFromMap(bastionMap),
	}, nil
}

func terminalEndpointFromMap(input map[string]any) *contracts.TerminalEndpoint {
	if len(input) == 0 {
		return nil
	}

	endpoint := &contracts.TerminalEndpoint{}
	if host, _ := input["host"].(string); strings.TrimSpace(host) != "" {
		endpoint.Host = strings.TrimSpace(host)
	}
	switch port := input["port"].(type) {
	case int:
		endpoint.Port = port
	case int32:
		endpoint.Port = int(port)
	case int64:
		endpoint.Port = int(port)
	case float64:
		endpoint.Port = int(port)
	}
	if username, _ := input["username"].(string); strings.TrimSpace(username) != "" {
		endpoint.Username = strings.TrimSpace(username)
	}
	if password, _ := input["password"].(string); password != "" {
		endpoint.Password = password
	}
	if privateKey, _ := input["privateKey"].(string); privateKey != "" {
		endpoint.PrivateKey = privateKey
	}
	if passphrase, _ := input["passphrase"].(string); passphrase != "" {
		endpoint.Passphrase = passphrase
	}

	if endpoint.Host == "" || endpoint.Port == 0 || endpoint.Username == "" {
		return nil
	}
	return endpoint
}
