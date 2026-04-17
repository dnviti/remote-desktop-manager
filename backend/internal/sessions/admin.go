package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
)

type ActiveSessionFilter struct {
	TenantID  string
	UserID    string
	Protocol  string
	GatewayID string
}

type ActiveSessionDTO struct {
	ID                string     `json:"id"`
	UserID            string     `json:"userId"`
	Username          string     `json:"username"`
	Email             string     `json:"email"`
	ConnectionID      string     `json:"connectionId"`
	ConnectionName    string     `json:"connectionName"`
	ConnectionHost    string     `json:"connectionHost"`
	ConnectionPort    int        `json:"connectionPort"`
	GatewayID         *string    `json:"gatewayId"`
	GatewayName       *string    `json:"gatewayName"`
	InstanceID        *string    `json:"instanceId"`
	InstanceName      *string    `json:"instanceName"`
	Protocol          string     `json:"protocol"`
	Status            string     `json:"status"`
	StartedAt         time.Time  `json:"startedAt"`
	LastActivityAt    time.Time  `json:"lastActivityAt"`
	EndedAt           *time.Time `json:"endedAt"`
	DurationFormatted string     `json:"durationFormatted"`
}

type GatewaySessionCount struct {
	GatewayID   string `json:"gatewayId"`
	GatewayName string `json:"gatewayName"`
	Count       int    `json:"count"`
}

type TerminatedSession struct {
	ID           string
	UserID       string
	ConnectionID string
	Protocol     string
}

func (s *Store) ListActiveSessions(ctx context.Context, filters ActiveSessionFilter) ([]ActiveSessionDTO, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	rows, err := s.db.Query(
		ctx,
		`SELECT s.id,
		        s."userId",
		        u.username,
		        u.email,
		        s."connectionId",
		        c.name,
		        c.host,
		        c.port,
		        s."gatewayId",
		        g.name,
		        s."instanceId",
		        i."containerName",
		        s.protocol::text,
		        s.status::text,
		        s."startedAt",
		        s."lastActivityAt",
		        s."endedAt"
		   FROM "ActiveSession" s
		   JOIN "User" u ON u.id = s."userId"
		   JOIN "Connection" c ON c.id = s."connectionId"
		   LEFT JOIN "Gateway" g ON g.id = s."gatewayId"
		   LEFT JOIN "ManagedGatewayInstance" i ON i.id = s."instanceId"
		  WHERE s."tenantId" = $1
		    AND ($2 = '' OR s."userId" = $2)
		    AND ($3 = '' OR s.protocol = $3::"SessionProtocol")
		    AND ($4 = '' OR s."gatewayId" = $4)
		    AND s.status <> 'CLOSED'::"SessionStatus"
		  ORDER BY s."startedAt" DESC`,
		filters.TenantID,
		filters.UserID,
		filters.Protocol,
		filters.GatewayID,
	)
	if err != nil {
		return nil, fmt.Errorf("list active sessions: %w", err)
	}
	defer rows.Close()

	result := make([]ActiveSessionDTO, 0)
	now := time.Now()
	for rows.Next() {
		var item ActiveSessionDTO
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.Username,
			&item.Email,
			&item.ConnectionID,
			&item.ConnectionName,
			&item.ConnectionHost,
			&item.ConnectionPort,
			&item.GatewayID,
			&item.GatewayName,
			&item.InstanceID,
			&item.InstanceName,
			&item.Protocol,
			&item.Status,
			&item.StartedAt,
			&item.LastActivityAt,
			&item.EndedAt,
		); err != nil {
			return nil, fmt.Errorf("scan active session: %w", err)
		}

		end := now
		if item.EndedAt != nil {
			end = *item.EndedAt
		}
		item.DurationFormatted = formatDuration(end.Sub(item.StartedAt).Milliseconds())
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active sessions: %w", err)
	}

	return result, nil
}

func (s *Store) CountActiveSessions(ctx context.Context, filters ActiveSessionFilter) (int, error) {
	if s.db == nil {
		return 0, errors.New("postgres is not configured")
	}

	var count int
	if err := s.db.QueryRow(
		ctx,
		`SELECT COUNT(*)
		   FROM "ActiveSession" s
		  WHERE s."tenantId" = $1
		    AND ($2 = '' OR s."userId" = $2)
		    AND ($3 = '' OR s.protocol = $3::"SessionProtocol")
		    AND ($4 = '' OR s."gatewayId" = $4)
		    AND s.status <> 'CLOSED'::"SessionStatus"`,
		filters.TenantID,
		filters.UserID,
		filters.Protocol,
		filters.GatewayID,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active sessions: %w", err)
	}
	return count, nil
}

func (s *Store) CountActiveSessionsByGateway(ctx context.Context, tenantID string) ([]GatewaySessionCount, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	rows, err := s.db.Query(
		ctx,
		`SELECT g.id, g.name, COUNT(*)::int
		   FROM "ActiveSession" s
		   JOIN "Gateway" g ON g.id = s."gatewayId"
		  WHERE g."tenantId" = $1
		    AND s."tenantId" = $1
		    AND s."gatewayId" IS NOT NULL
		    AND s.status <> 'CLOSED'::"SessionStatus"
		  GROUP BY g.id, g.name
		  ORDER BY g.name ASC`,
		tenantID,
	)
	if err != nil {
		return nil, fmt.Errorf("count sessions by gateway: %w", err)
	}
	defer rows.Close()

	result := make([]GatewaySessionCount, 0)
	for rows.Next() {
		var item GatewaySessionCount
		if err := rows.Scan(&item.GatewayID, &item.GatewayName, &item.Count); err != nil {
			return nil, fmt.Errorf("scan gateway session count: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gateway session counts: %w", err)
	}
	return result, nil
}

func (s *Store) TerminateTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*TerminatedSession, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin terminate session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

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
		    AND s."tenantId" = $2
		  FOR UPDATE`,
		sessionID,
		tenantID,
	)
	record, err := scanSessionRecord(row)
	if err != nil {
		return nil, err
	}

	recordingID := ""
	if normalizeSessionStatus(record.Status) != SessionStatusClosed {
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
			return nil, fmt.Errorf("close tenant session: %w", err)
		}

		recordingID, err = lookupRecordingID(ctx, tx, record.ID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("lookup recording id: %w", err)
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
			"reason":            "admin_terminated",
			"durationMs":        closedAt.Sub(record.StartedAt).Milliseconds(),
			"durationFormatted": formatDuration(closedAt.Sub(record.StartedAt).Milliseconds()),
			"gatewayName":       stringPtrValue(record.GatewayName),
			"instanceId":        stringPtrValue(record.InstanceID),
		}
		if recordingID != "" {
			details["recordingId"] = recordingID
		}
		detailsJSON, err := json.Marshal(details)
		if err != nil {
			return nil, fmt.Errorf("marshal session termination details: %w", err)
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
			return nil, fmt.Errorf("insert session end audit: %w", err)
		}
	}

	terminateJSON, err := json.Marshal(map[string]any{
		"terminatedUserId": record.UserID,
		"protocol":         record.Protocol,
		"connectionId":     record.ConnectionID,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal session terminate audit: %w", err)
	}
	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     adminUserID,
		Action:     "SESSION_TERMINATE",
		TargetType: "Session",
		TargetID:   record.ID,
		Details:    terminateJSON,
		IPAddress:  ipAddress,
	}); err != nil {
		return nil, fmt.Errorf("insert session terminate audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit terminate session: %w", err)
	}
	if shouldAutoCompleteRecording(record.Protocol) {
		if err := completeSessionRecordings(ctx, s.db, []string{recordingID}); err != nil {
			return nil, err
		}
	}

	return &TerminatedSession{
		ID:           record.ID,
		UserID:       record.UserID,
		ConnectionID: record.ConnectionID,
		Protocol:     record.Protocol,
	}, nil
}
