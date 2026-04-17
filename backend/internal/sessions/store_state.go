package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s *Store) HeartbeatOwnedSession(ctx context.Context, sessionID, userID string) error {
	if s.db == nil {
		return errors.New("postgres is not configured")
	}

	record, err := s.loadOwnedSession(ctx, sessionID, userID)
	if err != nil {
		return err
	}
	if normalizeSessionStatus(record.Status) == SessionStatusClosed {
		return ErrSessionClosed
	}

	targetStatus := heartbeatSessionStatus(record.Status)

	if _, err := s.db.Exec(
		ctx,
		`UPDATE "ActiveSession"
		    SET "lastActivityAt" = NOW(),
		        status = $2::"SessionStatus"
		  WHERE id = $1`,
		sessionID,
		targetStatus,
	); err != nil {
		return fmt.Errorf("heartbeat session: %w", err)
	}

	return nil
}

func (s *Store) LoadOwnedSessionState(ctx context.Context, sessionID, userID string) (*SessionState, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	row := s.db.QueryRow(
		ctx,
		`SELECT s.id,
		        s."userId",
		        s."connectionId",
		        s.protocol::text,
		        s."gatewayId",
		        s."instanceId",
		        s."ipAddress",
		        s."startedAt",
		        s.status::text,
		        COALESCE(s.metadata, '{}'::jsonb)::text
		   FROM "ActiveSession" s
		  WHERE s.id = $1
		    AND s."userId" = $2`,
		sessionID,
		userID,
	)

	var (
		record       sessionRecord
		metadataText string
	)
	if err := row.Scan(
		&record.ID,
		&record.UserID,
		&record.ConnectionID,
		&record.Protocol,
		&record.GatewayID,
		&record.InstanceID,
		&record.IPAddress,
		&record.StartedAt,
		&record.Status,
		&metadataText,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("scan session state: %w", err)
	}

	state := &SessionState{
		Record:   record,
		Metadata: map[string]any{},
	}
	if strings.TrimSpace(metadataText) != "" {
		if err := json.Unmarshal([]byte(metadataText), &state.Metadata); err != nil {
			return nil, fmt.Errorf("decode session metadata: %w", err)
		}
	}
	return state, nil
}

func (s *Store) UpdateOwnedSessionMetadata(ctx context.Context, sessionID, userID string, metadata map[string]any) error {
	if s.db == nil {
		return errors.New("postgres is not configured")
	}

	record, err := s.loadOwnedSession(ctx, sessionID, userID)
	if err != nil {
		return err
	}
	if normalizeSessionStatus(record.Status) == SessionStatusClosed {
		return ErrSessionClosed
	}

	metadataJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal session metadata: %w", err)
	}

	if _, err := s.db.Exec(
		ctx,
		`UPDATE "ActiveSession"
		    SET metadata = $3::jsonb,
		        "lastActivityAt" = NOW()
		  WHERE id = $1
		    AND "userId" = $2`,
		sessionID,
		userID,
		string(metadataJSON),
	); err != nil {
		return fmt.Errorf("update session metadata: %w", err)
	}

	return nil
}

func (s *Store) loadOwnedSession(ctx context.Context, sessionID, userID string) (*sessionRecord, error) {
	row := s.db.QueryRow(
		ctx,
		`SELECT s.id,
		        s."userId",
		        s."connectionId",
		        s.protocol::text,
		        s."gatewayId",
		        s."instanceId",
		        s."ipAddress",
		        s."startedAt",
		        s.status::text
		   FROM "ActiveSession" s
		  WHERE s.id = $1
		    AND s."userId" = $2`,
		sessionID,
		userID,
	)
	return scanSessionRecord(row)
}

func loadOwnedSessionForUpdate(ctx context.Context, tx pgx.Tx, sessionID, userID string) (*sessionRecord, error) {
	row := tx.QueryRow(
		ctx,
		`SELECT s.id,
		        s."userId",
		        s."connectionId",
		        s.protocol::text,
		        s."gatewayId",
		        s."instanceId",
		        s."ipAddress",
		        s."startedAt",
		        s.status::text
		   FROM "ActiveSession" s
		  WHERE s.id = $1
		    AND s."userId" = $2
		  FOR UPDATE`,
		sessionID,
		userID,
	)
	return scanSessionRecord(row)
}
