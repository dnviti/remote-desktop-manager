package sshsessions

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/connectionaccess"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type ResolveError = connectionaccess.ResolveError
type ResolveConnectionOptions = connectionaccess.ResolveConnectionOptions
type ConnectionSnapshot = connectionaccess.ConnectionSnapshot
type ResolvedConnection = connectionaccess.ResolvedConnection
type ResolvedCredentials = connectionaccess.ResolvedCredentials
type ResolvedFileTransferTarget = connectionaccess.ResolvedFileTransferTarget

func (s Service) ResolveConnection(ctx context.Context, userID, tenantID, connectionID string, opts ResolveConnectionOptions) (ResolvedConnection, error) {
	access, err := s.loadAccess(ctx, userID, tenantID, strings.TrimSpace(connectionID))
	if err != nil {
		return ResolvedConnection{}, mapResolveError(err)
	}

	expectedType := strings.ToUpper(strings.TrimSpace(opts.ExpectedType))
	if expectedType != "" && !strings.EqualFold(access.Connection.Type, expectedType) {
		return ResolvedConnection{}, &ResolveError{
			Status:  http.StatusBadRequest,
			Message: "Not a " + expectedType + " connection",
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
		return ResolvedConnection{}, mapResolveError(err)
	}

	return ResolvedConnection{
		Connection: snapshotConnectionRecord(access.Connection),
		AccessType: access.AccessType,
		Credentials: ResolvedCredentials{
			Username:         credentials.Username,
			Password:         credentials.Password,
			Domain:           credentials.Domain,
			PrivateKey:       credentials.PrivateKey,
			Passphrase:       credentials.Passphrase,
			CredentialSource: credentials.CredentialSource,
		},
	}, nil
}

func (s Service) CreateTunnelProxy(ctx context.Context, gatewayID, targetHost string, targetPort int) (contracts.TunnelProxyResponse, error) {
	proxy, err := s.createTunnelProxy(ctx, gatewayID, targetHost, targetPort)
	if err != nil {
		return contracts.TunnelProxyResponse{}, mapResolveError(err)
	}
	return contracts.TunnelProxyResponse{
		ID:        proxy.ID,
		Host:      proxy.Host,
		Port:      proxy.Port,
		ExpiresIn: proxy.ExpiresIn,
	}, nil
}

func mapResolveError(err error) error {
	if err == nil {
		return nil
	}

	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return &ResolveError{
			Status:  reqErr.status,
			Message: reqErr.message,
		}
	}

	return err
}

func cloneRawJSON(value json.RawMessage) json.RawMessage {
	if len(value) == 0 {
		return nil
	}
	cloned := make([]byte, len(value))
	copy(cloned, value)
	return cloned
}

func cloneIntPtr(value *int) *int {
	if value == nil {
		return nil
	}
	cloned := *value
	return &cloned
}

func snapshotConnectionRecord(record connectionRecord) ConnectionSnapshot {
	return ConnectionSnapshot{
		ID:                      record.ID,
		Type:                    record.Type,
		Host:                    record.Host,
		Port:                    record.Port,
		TeamID:                  cloneStringPtr(record.TeamID),
		GatewayID:               cloneStringPtr(record.GatewayID),
		TargetDBHost:            cloneStringPtr(record.TargetDBHost),
		TargetDBPort:            cloneIntPtr(record.TargetDBPort),
		DBType:                  cloneStringPtr(record.DBType),
		DBSettings:              cloneRawJSON(record.DBSettings),
		DLPPolicy:               cloneRawJSON(record.DLPPolicy),
		TransferRetentionPolicy: cloneRawJSON(record.TransferRetentionPolicy),
	}
}

func (s Service) HTTPClientForConnectionAccess() *http.Client {
	return s.HTTPClient
}
