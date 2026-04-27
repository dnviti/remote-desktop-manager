package dbsessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/connectionaccess"
	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func (s Service) resolveOwnedQueryRuntime(ctx context.Context, userID, tenantID, sessionID string) (*ownedQueryRuntime, error) {
	if s.Store == nil || s.DB == nil {
		return nil, errors.New("database session dependencies are unavailable")
	}

	state, err := s.Store.LoadOwnedSessionState(ctx, strings.TrimSpace(sessionID), strings.TrimSpace(userID))
	if err != nil {
		return nil, err
	}
	if state.Record.Status == "CLOSED" {
		return nil, sessions.ErrSessionClosed
	}

	var connection ownedConnectionSnapshot
	if err := s.DB.QueryRow(ctx, `
SELECT id, host, port, COALESCE("dbSettings", '{}'::jsonb)::text
FROM "Connection"
WHERE id = $1
`, state.Record.ConnectionID).Scan(&connection.ID, &connection.Host, &connection.Port, &connection.DBSettings); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, sessions.ErrSessionNotFound
		}
		return nil, fmt.Errorf("load connection for database session runtime: %w", err)
	}

	settings := parseDatabaseSettings(connection.DBSettings)
	dbProtocol := normalizeDatabaseProtocol(settings.Protocol)
	sessionConfig := sessionConfigFromMetadata(state.Metadata)
	usesOverrideCredentials := metadataBool(state.Metadata, "usesOverrideCredentials")
	if !shouldUseOwnedDatabaseSessionRuntime(dbProtocol, usesOverrideCredentials) {
		return nil, ErrQueryRuntimeUnsupported
	}

	resolveOpts := connectionaccess.ResolveConnectionOptions{ExpectedType: "DATABASE"}
	if usesOverrideCredentials {
		username, password, err := resolveOverrideCredentials(state.Metadata, s.ServerEncryptionKey)
		if err != nil {
			return nil, &requestError{status: 502, message: "database session override credentials are unavailable"}
		}
		resolveOpts.OverrideUsername = username
		resolveOpts.OverridePassword = password
	}

	resolution, err := s.ConnectionResolver.ResolveConnection(ctx, userID, tenantID, state.Record.ConnectionID, resolveOpts)
	if err != nil {
		return nil, err
	}

	target := buildDatabaseTarget(
		connection.Host,
		connection.Port,
		dbProtocol,
		strings.TrimSpace(settings.DatabaseName),
		resolution.Credentials,
		settings,
		sessionConfig,
	)
	if target == nil {
		return nil, &requestError{status: 502, message: "database target is unavailable"}
	}

	gatewayID := ""
	if state.Record.GatewayID != nil {
		gatewayID = strings.TrimSpace(*state.Record.GatewayID)
	}
	instanceID := ""
	if state.Record.InstanceID != nil {
		instanceID = strings.TrimSpace(*state.Record.InstanceID)
	}

	return &ownedQueryRuntime{
		State:                   state,
		Connection:              connection,
		Settings:                settings,
		Target:                  target,
		Protocol:                dbProtocol,
		PersistExecutionPlan:    settings.PersistExecutionPlan,
		SessionConfig:           sessionConfig,
		UsesOverrideCredentials: usesOverrideCredentials,
		DatabaseName:            target.Database,
		GatewayID:               gatewayID,
		InstanceID:              instanceID,
	}, nil
}

func (s Service) touchOwnedSession(ctx context.Context, sessionID string) error {
	if s.DB == nil {
		return nil
	}
	_, err := s.DB.Exec(ctx, `
UPDATE "ActiveSession"
SET "lastActivityAt" = NOW()
WHERE id = $1
`, sessionID)
	return err
}
