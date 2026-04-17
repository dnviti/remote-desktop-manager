package terminalbroker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessionrecording"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionStore interface {
	FinalizeTerminalSession(ctx context.Context, sessionID, recordingID string) error
	HeartbeatTerminalSession(ctx context.Context, sessionID string) error
	GetTerminalSessionState(ctx context.Context, sessionID string) (TerminalSessionState, error)
}

type NoopSessionStore struct{}

func (NoopSessionStore) FinalizeTerminalSession(context.Context, string, string) error {
	return nil
}

func (NoopSessionStore) HeartbeatTerminalSession(context.Context, string) error {
	return nil
}

func (NoopSessionStore) GetTerminalSessionState(context.Context, string) (TerminalSessionState, error) {
	return TerminalSessionState{}, nil
}

type PostgresSessionStore struct {
	db *pgxpool.Pool
}

func NewPostgresSessionStore(db *pgxpool.Pool) SessionStore {
	if db == nil {
		return NoopSessionStore{}
	}
	return &PostgresSessionStore{db: db}
}

type sessionRecord struct {
	ID           string
	UserID       string
	ConnectionID string
	Protocol     string
	GatewayID    *string
	IPAddress    *string
	StartedAt    time.Time
}

type TerminalSessionState struct {
	Exists bool
	Closed bool
	Paused bool
	Reason string
}

func (s *PostgresSessionStore) FinalizeTerminalSession(ctx context.Context, sessionID, recordingID string) error {
	if sessionID == "" {
		if recordingID != "" {
			return sessionrecording.CompleteRecording(ctx, s.db, recordingID)
		}
		return nil
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin terminal session finalization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	record, err := loadSession(ctx, tx, sessionID)
	if err != nil {
		if err == pgx.ErrNoRows {
			if recordingID != "" {
				return sessionrecording.CompleteRecording(ctx, s.db, recordingID)
			}
			return nil
		}
		return fmt.Errorf("load terminal session: %w", err)
	}
	if recordingID == "" {
		recordingID, err = lookupRecordingID(ctx, tx, record.ID)
		if err != nil && err != pgx.ErrNoRows {
			return fmt.Errorf("lookup terminal recording: %w", err)
		}
	}

	closedAt := time.Now().UTC()
	durationMs := closedAt.Sub(record.StartedAt).Milliseconds()
	if _, err := tx.Exec(
		ctx,
		`UPDATE "ActiveSession"
		 SET status = 'CLOSED'::"SessionStatus",
		     "endedAt" = $2
		 WHERE id = $1 AND status <> 'CLOSED'::"SessionStatus"`,
		record.ID,
		closedAt,
	); err != nil {
		return fmt.Errorf("close terminal session: %w", err)
	}

	details, err := json.Marshal(map[string]any{
		"sessionId":  record.ID,
		"protocol":   record.Protocol,
		"reason":     "terminal_close",
		"durationMs": durationMs,
	})
	if err != nil {
		return fmt.Errorf("marshal terminal audit details: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
				id, "userId", action, "targetType", "targetId", details, "ipAddress", "gatewayId", "geoCoords", flags
			) VALUES (
				$1,
				$2,
				'SESSION_END'::"AuditAction",
				$3,
				$4,
				$5::jsonb,
				$6,
				$7,
				ARRAY[]::double precision[],
				ARRAY[]::text[]
			)`,
		uuid.NewString(),
		record.UserID,
		"Connection",
		record.ConnectionID,
		string(details),
		record.IPAddress,
		record.GatewayID,
	); err != nil {
		return fmt.Errorf("insert terminal audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit terminal finalization: %w", err)
	}

	if recordingID != "" {
		if err := sessionrecording.CompleteRecording(ctx, s.db, recordingID); err != nil {
			return err
		}
	}

	return nil
}

func lookupRecordingID(ctx context.Context, tx pgx.Tx, sessionID string) (string, error) {
	row := tx.QueryRow(
		ctx,
		`SELECT id
		 FROM "SessionRecording"
		 WHERE "sessionId" = $1
		 ORDER BY "createdAt" DESC
		 LIMIT 1`,
		sessionID,
	)

	var recordingID string
	if err := row.Scan(&recordingID); err != nil {
		return "", err
	}
	return recordingID, nil
}

func (s *PostgresSessionStore) HeartbeatTerminalSession(ctx context.Context, sessionID string) error {
	if sessionID == "" {
		return nil
	}

	if _, err := s.db.Exec(
		ctx,
		`UPDATE "ActiveSession"
		 SET "lastActivityAt" = NOW(),
		     status = CASE
		         WHEN status = 'PAUSED'::"SessionStatus" THEN 'PAUSED'::"SessionStatus"
		         ELSE 'ACTIVE'::"SessionStatus"
		     END
		 WHERE id = $1
		   AND status <> 'CLOSED'::"SessionStatus"`,
		sessionID,
	); err != nil {
		return fmt.Errorf("heartbeat terminal session: %w", err)
	}

	return nil
}

func (s *PostgresSessionStore) GetTerminalSessionState(ctx context.Context, sessionID string) (TerminalSessionState, error) {
	if sessionID == "" {
		return TerminalSessionState{}, nil
	}

	row := s.db.QueryRow(
		ctx,
		`SELECT status::text
		 FROM "ActiveSession"
		 WHERE id = $1`,
		sessionID,
	)

	var status string
	if err := row.Scan(&status); err != nil {
		if err == pgx.ErrNoRows {
			return TerminalSessionState{}, nil
		}
		return TerminalSessionState{}, fmt.Errorf("load terminal session state: %w", err)
	}

	state := TerminalSessionState{Exists: true, Closed: status == "CLOSED", Paused: status == "PAUSED"}
	if !state.Closed {
		return state, nil
	}

	reason, err := loadTerminalSessionCloseReason(ctx, s.db, sessionID)
	if err != nil && err != pgx.ErrNoRows {
		return TerminalSessionState{}, fmt.Errorf("load terminal session close reason: %w", err)
	}
	state.Reason = reason
	return state, nil
}

func loadSession(ctx context.Context, tx pgx.Tx, sessionID string) (*sessionRecord, error) {
	row := tx.QueryRow(
		ctx,
		`SELECT id, "userId", "connectionId", protocol::text, "gatewayId", "ipAddress", "startedAt"
		 FROM "ActiveSession"
		 WHERE id = $1
		   AND status <> 'CLOSED'::"SessionStatus"
		 FOR UPDATE`,
		sessionID,
	)

	var record sessionRecord
	if err := row.Scan(
		&record.ID,
		&record.UserID,
		&record.ConnectionID,
		&record.Protocol,
		&record.GatewayID,
		&record.IPAddress,
		&record.StartedAt,
	); err != nil {
		return nil, err
	}

	return &record, nil
}

func loadTerminalSessionCloseReason(ctx context.Context, db *pgxpool.Pool, sessionID string) (string, error) {
	row := db.QueryRow(
		ctx,
		`SELECT action::text, COALESCE(details->>'reason', '')
		 FROM "AuditLog"
		 WHERE details->>'sessionId' = $1
		   AND action IN (
		     'SESSION_END'::"AuditAction",
		     'SESSION_TIMEOUT'::"AuditAction",
		     'SESSION_ABSOLUTE_TIMEOUT'::"AuditAction"
		   )
		 ORDER BY "createdAt" DESC
		 LIMIT 1`,
		sessionID,
	)

	var (
		action string
		reason string
	)
	if err := row.Scan(&action, &reason); err != nil {
		return "", err
	}

	switch action {
	case "SESSION_TIMEOUT", "SESSION_ABSOLUTE_TIMEOUT":
		return "timeout", nil
	case "SESSION_END":
		if reason != "" {
			return reason, nil
		}
	}

	return "closed", nil
}
