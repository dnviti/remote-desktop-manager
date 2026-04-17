package desktopbroker

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type SessionStore interface {
	FinalizeDesktopSession(ctx context.Context, tokenHash, recordingID string) error
	GetDesktopSessionState(ctx context.Context, tokenHash string) (DesktopSessionState, error)
	GetDesktopSessionStateBySessionID(ctx context.Context, sessionID string) (DesktopSessionState, error)
	RecordDesktopConnectionReady(ctx context.Context, tokenHash, connectionID string) error
}

type NoopSessionStore struct{}

func (NoopSessionStore) FinalizeDesktopSession(context.Context, string, string) error {
	return nil
}

func (NoopSessionStore) GetDesktopSessionState(context.Context, string) (DesktopSessionState, error) {
	return DesktopSessionState{}, nil
}

func (NoopSessionStore) GetDesktopSessionStateBySessionID(context.Context, string) (DesktopSessionState, error) {
	return DesktopSessionState{}, nil
}

func (NoopSessionStore) RecordDesktopConnectionReady(context.Context, string, string) error {
	return nil
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

type recordingRecord struct {
	ID             string
	UserID         string
	ConnectionID   string
	Protocol       string
	FilePath       string
	Status         string
	CreatedAt      time.Time
	ConnectionName *string
}

type DesktopSessionState struct {
	Exists bool
	Closed bool
	Paused bool
	Reason string
}

func (s *PostgresSessionStore) FinalizeDesktopSession(ctx context.Context, tokenHash, recordingID string) error {
	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin session finalization: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	session, err := loadOpenSession(ctx, tx, tokenHash)
	if err != nil && err != pgx.ErrNoRows {
		return fmt.Errorf("load open session: %w", err)
	}

	if session != nil {
		closedAt := time.Now().UTC()
		durationMs := closedAt.Sub(session.StartedAt).Milliseconds()
		if _, err := tx.Exec(
			ctx,
			`UPDATE "ActiveSession"
			 SET status = 'CLOSED'::"SessionStatus",
			     "endedAt" = $2
			 WHERE id = $1 AND status <> 'CLOSED'::"SessionStatus"`,
			session.ID,
			closedAt,
		); err != nil {
			return fmt.Errorf("close active session: %w", err)
		}

		if recordingID == "" {
			recordingID, err = lookupRecordingID(ctx, tx, session.ID)
			if err != nil && err != pgx.ErrNoRows {
				return fmt.Errorf("lookup session recording: %w", err)
			}
		}

		details, err := json.Marshal(map[string]any{
			"sessionId":   session.ID,
			"protocol":    session.Protocol,
			"reason":      "guac_close",
			"durationMs":  durationMs,
			"recordingId": emptyToNil(recordingID),
		})
		if err != nil {
			return fmt.Errorf("marshal audit details: %w", err)
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
			session.UserID,
			"Connection",
			session.ConnectionID,
			string(details),
			session.IPAddress,
			session.GatewayID,
		); err != nil {
			return fmt.Errorf("insert session audit: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit session finalization: %w", err)
	}

	if recordingID != "" {
		if err := completeRecording(ctx, s.db, recordingID); err != nil {
			return err
		}
	}

	return nil
}

func loadOpenSession(ctx context.Context, tx pgx.Tx, tokenHash string) (*sessionRecord, error) {
	row := tx.QueryRow(
		ctx,
		`SELECT id, "userId", "connectionId", protocol::text, "gatewayId", "ipAddress", "startedAt"
		 FROM "ActiveSession"
		 WHERE "guacTokenHash" = $1
		   AND status <> 'CLOSED'::"SessionStatus"
		 ORDER BY "startedAt" DESC
		 LIMIT 1
		 FOR UPDATE`,
		tokenHash,
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

func (s *PostgresSessionStore) GetDesktopSessionState(ctx context.Context, tokenHash string) (DesktopSessionState, error) {
	if tokenHash == "" {
		return DesktopSessionState{}, nil
	}

	row := s.db.QueryRow(
		ctx,
		`SELECT id, status::text
		 FROM "ActiveSession"
		 WHERE "guacTokenHash" = $1
		 ORDER BY "startedAt" DESC
		 LIMIT 1`,
		tokenHash,
	)

	return s.loadDesktopSessionState(ctx, row)
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

func completeRecording(ctx context.Context, db *pgxpool.Pool, recordingID string) error {
	recording, err := loadRecording(ctx, db, recordingID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return nil
		}
		return fmt.Errorf("load recording: %w", err)
	}

	if recording.Status != "RECORDING" {
		return nil
	}

	stat, err := os.Stat(recording.FilePath)
	if err != nil {
		if _, updateErr := db.Exec(
			ctx,
			`UPDATE "SessionRecording"
			 SET status = 'ERROR'::"RecordingStatus",
			     "completedAt" = $2
			 WHERE id = $1`,
			recording.ID,
			time.Now().UTC(),
		); updateErr != nil {
			return fmt.Errorf("mark recording error: %w", updateErr)
		}
		return nil
	}
	if err := ensureRecordingReadable(recording.FilePath, stat); err != nil {
		if _, updateErr := db.Exec(
			ctx,
			`UPDATE "SessionRecording"
			 SET status = 'ERROR'::"RecordingStatus",
			     "completedAt" = $2
			 WHERE id = $1`,
			recording.ID,
			time.Now().UTC(),
		); updateErr != nil {
			return fmt.Errorf("mark recording error after chmod failure: %w", updateErr)
		}
		return fmt.Errorf("ensure recording readable: %w", err)
	}

	duration := int(time.Since(recording.CreatedAt).Seconds())
	completedAt := time.Now().UTC()
	if _, err := db.Exec(
		ctx,
		`UPDATE "SessionRecording"
		 SET status = 'COMPLETE'::"RecordingStatus",
		     "fileSize" = $2,
		     duration = $3,
		     "completedAt" = $4
		 WHERE id = $1`,
		recording.ID,
		int(stat.Size()),
		duration,
		completedAt,
	); err != nil {
		return fmt.Errorf("complete recording: %w", err)
	}

	label := recording.Protocol
	if recording.ConnectionName != nil && *recording.ConnectionName != "" {
		label = *recording.ConnectionName
	}

	if _, err := db.Exec(
		ctx,
		`INSERT INTO "Notification" (id, "userId", type, message, "read", "relatedId", "createdAt")
		 VALUES ($1, $2, 'RECORDING_READY'::"NotificationType", $3, false, $4, NOW())`,
		uuid.NewString(),
		recording.UserID,
		fmt.Sprintf("Your %s session recording is ready", label),
		recording.ID,
	); err != nil {
		return fmt.Errorf("create recording notification: %w", err)
	}

	return nil
}

func loadDesktopSessionCloseReason(ctx context.Context, db *pgxpool.Pool, sessionID string) (string, error) {
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

func ensureRecordingReadable(filePath string, stat os.FileInfo) error {
	mode := stat.Mode().Perm()
	readableMode := mode | 0o044
	if readableMode == mode {
		return nil
	}
	if err := os.Chmod(filePath, readableMode); err != nil {
		return err
	}
	return nil
}

func loadRecording(ctx context.Context, db *pgxpool.Pool, recordingID string) (*recordingRecord, error) {
	row := db.QueryRow(
		ctx,
		`SELECT sr.id, sr."userId", sr."connectionId", sr.protocol::text, sr."filePath",
		        sr.status::text, sr."createdAt", c.name
		 FROM "SessionRecording" sr
		 LEFT JOIN "Connection" c ON c.id = sr."connectionId"
		 WHERE sr.id = $1`,
		recordingID,
	)

	var record recordingRecord
	if err := row.Scan(
		&record.ID,
		&record.UserID,
		&record.ConnectionID,
		&record.Protocol,
		&record.FilePath,
		&record.Status,
		&record.CreatedAt,
		&record.ConnectionName,
	); err != nil {
		return nil, err
	}

	return &record, nil
}

func emptyToNil(value string) any {
	if value == "" {
		return nil
	}
	return value
}
