package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var (
	ErrSessionNotFound = errors.New("session not found")
	ErrSessionClosed   = errors.New("session already closed")
)

type RoutingDecision struct {
	Strategy             string `json:"strategy,omitempty"`
	CandidateCount       int    `json:"candidateCount,omitempty"`
	SelectedSessionCount int    `json:"selectedSessionCount,omitempty"`
}

type StartSessionParams struct {
	UserID          string
	ConnectionID    string
	GatewayID       string
	InstanceID      string
	Protocol        string
	SocketID        string
	GuacTokenHash   string
	IPAddress       string
	Metadata        map[string]any
	RoutingDecision *RoutingDecision
	RecordingID     string
}

type sessionRecord struct {
	ID           string
	UserID       string
	ConnectionID string
	Protocol     string
	GatewayID    *string
	GatewayName  *string
	InstanceID   *string
	IPAddress    *string
	StartedAt    time.Time
	Status       string
}

type SessionState struct {
	Record   sessionRecord
	Metadata map[string]any
}

type Store struct {
	db *pgxpool.Pool
}

func NewStore(db *pgxpool.Pool) *Store {
	return &Store{db: db}
}

func (s *Store) CloseStaleSessionsForConnection(ctx context.Context, userID, connectionID, protocol string) (int, error) {
	if s.db == nil {
		return 0, nil
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("begin close stale sessions: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	rows, err := tx.Query(
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
		  WHERE s."userId" = $1
		    AND s."connectionId" = $2
		    AND s.protocol = $3::"SessionProtocol"
		    AND s.status <> 'CLOSED'::"SessionStatus"
		  ORDER BY s."startedAt" DESC
		  FOR UPDATE`,
		userID,
		connectionID,
		protocol,
	)
	if err != nil {
		return 0, fmt.Errorf("query stale sessions: %w", err)
	}
	defer rows.Close()

	var stale []sessionRecord
	for rows.Next() {
		var record sessionRecord
		if err := rows.Scan(
			&record.ID,
			&record.UserID,
			&record.ConnectionID,
			&record.Protocol,
			&record.GatewayID,
			&record.InstanceID,
			&record.IPAddress,
			&record.StartedAt,
			&record.Status,
		); err != nil {
			return 0, fmt.Errorf("scan stale session: %w", err)
		}
		stale = append(stale, record)
	}
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate stale sessions: %w", err)
	}

	if len(stale) == 0 {
		if err := tx.Commit(ctx); err != nil {
			return 0, fmt.Errorf("commit empty stale session close: %w", err)
		}
		return 0, nil
	}

	closedAt := time.Now().UTC()
	for _, record := range stale {
		if _, err := tx.Exec(
			ctx,
			`UPDATE "ActiveSession"
			    SET status = 'CLOSED'::"SessionStatus",
			        "endedAt" = $2
			  WHERE id = $1`,
			record.ID,
			closedAt,
		); err != nil {
			return 0, fmt.Errorf("close stale session %s: %w", record.ID, err)
		}

		var gatewayName any
		if record.GatewayID != nil && *record.GatewayID != "" {
			name, nameErr := loadGatewayName(ctx, tx, *record.GatewayID)
			if nameErr == nil && name != "" {
				gatewayName = name
			}
		}

		details, err := json.Marshal(map[string]any{
			"sessionId":         record.ID,
			"protocol":          record.Protocol,
			"reason":            "superseded_by_new_session",
			"durationMs":        closedAt.Sub(record.StartedAt).Milliseconds(),
			"durationFormatted": formatDuration(closedAt.Sub(record.StartedAt).Milliseconds()),
			"gatewayName":       gatewayName,
			"instanceId":        stringPtrValue(record.InstanceID),
		})
		if err != nil {
			return 0, fmt.Errorf("marshal stale session audit details: %w", err)
		}

		if err := insertAuditLog(ctx, tx, auditLogParams{
			UserID:     record.UserID,
			Action:     "SESSION_END",
			TargetType: "Connection",
			TargetID:   record.ConnectionID,
			Details:    details,
			IPAddress:  record.IPAddress,
			GatewayID:  record.GatewayID,
		}); err != nil {
			return 0, fmt.Errorf("insert stale session audit: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, fmt.Errorf("commit stale session close: %w", err)
	}

	return len(stale), nil
}

func (s *Store) StartSession(ctx context.Context, params StartSessionParams) (string, error) {
	if s.db == nil {
		return "", errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin start session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sessionID := uuid.NewString()
	metadataJSON, err := json.Marshal(params.Metadata)
	if err != nil {
		return "", fmt.Errorf("marshal session metadata: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "ActiveSession" (
			 id, "userId", "connectionId", "gatewayId", "instanceId", protocol, status, "socketId", "guacTokenHash", "ipAddress", metadata
		 ) VALUES (
			 $1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6::"SessionProtocol", 'ACTIVE'::"SessionStatus", NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), $10::jsonb
		 )`,
		sessionID,
		params.UserID,
		params.ConnectionID,
		params.GatewayID,
		params.InstanceID,
		params.Protocol,
		params.SocketID,
		params.GuacTokenHash,
		params.IPAddress,
		string(metadataJSON),
	); err != nil {
		return "", fmt.Errorf("insert active session: %w", err)
	}

	detailsMap := make(map[string]any, len(params.Metadata)+8)
	for key, value := range params.Metadata {
		detailsMap[key] = value
	}
	detailsMap["sessionId"] = sessionID
	detailsMap["protocol"] = params.Protocol
	if params.RecordingID != "" {
		detailsMap["recordingId"] = params.RecordingID
	}
	if params.RoutingDecision != nil {
		if params.RoutingDecision.Strategy != "" {
			detailsMap["lbStrategy"] = params.RoutingDecision.Strategy
		}
		if params.RoutingDecision.CandidateCount > 0 {
			detailsMap["lbCandidates"] = params.RoutingDecision.CandidateCount
		}
		if params.RoutingDecision.SelectedSessionCount > 0 {
			detailsMap["lbSelectedSessions"] = params.RoutingDecision.SelectedSessionCount
		}
	}

	gatewayID := stringToPtr(params.GatewayID)
	if gatewayID != nil {
		gatewayName, err := loadGatewayName(ctx, tx, *gatewayID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("load gateway name: %w", err)
		}
		if gatewayName != "" {
			detailsMap["gatewayName"] = gatewayName
		}
		if params.InstanceID != "" {
			detailsMap["instanceId"] = params.InstanceID
		}
	}

	detailsJSON, err := json.Marshal(detailsMap)
	if err != nil {
		return "", fmt.Errorf("marshal session start audit details: %w", err)
	}

	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     params.UserID,
		Action:     "SESSION_START",
		TargetType: "Connection",
		TargetID:   params.ConnectionID,
		Details:    detailsJSON,
		IPAddress:  stringToPtr(params.IPAddress),
		GatewayID:  gatewayID,
	}); err != nil {
		return "", fmt.Errorf("insert session start audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit start session: %w", err)
	}

	return sessionID, nil
}

func (s *Store) HeartbeatOwnedSession(ctx context.Context, sessionID, userID string) error {
	if s.db == nil {
		return errors.New("postgres is not configured")
	}

	record, err := s.loadOwnedSession(ctx, sessionID, userID)
	if err != nil {
		return err
	}
	if record.Status == "CLOSED" {
		return ErrSessionClosed
	}

	if _, err := s.db.Exec(
		ctx,
		`UPDATE "ActiveSession"
		    SET "lastActivityAt" = NOW(),
		        status = 'ACTIVE'::"SessionStatus"
		  WHERE id = $1`,
		sessionID,
	); err != nil {
		return fmt.Errorf("heartbeat session: %w", err)
	}

	return nil
}

func (s *Store) EndOwnedSession(ctx context.Context, sessionID, userID, reason string) error {
	if s.db == nil {
		return errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin end session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	record, err := loadOwnedSessionForUpdate(ctx, tx, sessionID, userID)
	if err != nil {
		return err
	}

	if record.Status == "CLOSED" {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit closed session end noop: %w", err)
		}
		return nil
	}

	closedAt := time.Now().UTC()
	if _, err := tx.Exec(
		ctx,
		`UPDATE "ActiveSession"
		    SET status = 'CLOSED'::"SessionStatus",
		        "endedAt" = $2
		  WHERE id = $1`,
		record.ID,
		closedAt,
	); err != nil {
		return fmt.Errorf("close session: %w", err)
	}

	recordingID, err := lookupRecordingID(ctx, tx, record.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lookup recording id: %w", err)
	}

	if record.GatewayID != nil && *record.GatewayID != "" {
		gatewayName, nameErr := loadGatewayName(ctx, tx, *record.GatewayID)
		if nameErr == nil && gatewayName != "" {
			record.GatewayName = &gatewayName
		}
	}

	details := map[string]any{
		"sessionId":         record.ID,
		"protocol":          record.Protocol,
		"durationMs":        closedAt.Sub(record.StartedAt).Milliseconds(),
		"durationFormatted": formatDuration(closedAt.Sub(record.StartedAt).Milliseconds()),
		"gatewayName":       stringPtrValue(record.GatewayName),
		"instanceId":        stringPtrValue(record.InstanceID),
	}
	if reason != "" {
		details["reason"] = reason
	}
	if recordingID != "" {
		details["recordingId"] = recordingID
	}

	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal session end audit details: %w", err)
	}

	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     record.UserID,
		Action:     "SESSION_END",
		TargetType: "Connection",
		TargetID:   record.ConnectionID,
		Details:    detailsJSON,
		IPAddress:  record.IPAddress,
		GatewayID:  record.GatewayID,
	}); err != nil {
		return fmt.Errorf("insert session end audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit end session: %w", err)
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
	if record.Status == "CLOSED" {
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

func scanSessionRecord(row pgx.Row) (*sessionRecord, error) {
	var record sessionRecord
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
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("scan session record: %w", err)
	}
	return &record, nil
}

func loadGatewayName(ctx context.Context, tx pgx.Tx, gatewayID string) (string, error) {
	row := tx.QueryRow(ctx, `SELECT name FROM "Gateway" WHERE id = $1`, gatewayID)
	var gatewayName string
	if err := row.Scan(&gatewayName); err != nil {
		return "", err
	}
	return gatewayName, nil
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

type auditLogParams struct {
	UserID     string
	Action     string
	TargetType string
	TargetID   string
	Details    []byte
	IPAddress  *string
	GatewayID  *string
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, params auditLogParams) error {
	_, err := tx.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			 id, "userId", action, "targetType", "targetId", details, "ipAddress", "gatewayId", "geoCoords", flags
		 ) VALUES (
			 $1, $2, $3::"AuditAction", $4, $5, $6::jsonb, $7, $8, ARRAY[]::double precision[], ARRAY[]::text[]
		 )`,
		uuid.NewString(),
		nilIfEmpty(params.UserID),
		params.Action,
		nilIfEmpty(params.TargetType),
		nilIfEmpty(params.TargetID),
		string(params.Details),
		params.IPAddress,
		params.GatewayID,
	)
	return err
}

func formatDuration(ms int64) string {
	seconds := ms / 1000
	minutes := seconds / 60
	hours := minutes / 60
	if hours > 0 {
		return fmt.Sprintf("%dh %dm %ds", hours, minutes%60, seconds%60)
	}
	if minutes > 0 {
		return fmt.Sprintf("%dm %ds", minutes, seconds%60)
	}
	return fmt.Sprintf("%ds", seconds)
}

func nilIfEmpty(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringToPtr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}

func stringPtrValue(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}
