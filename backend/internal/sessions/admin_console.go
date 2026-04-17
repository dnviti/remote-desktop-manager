package sessions

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

type SessionConsoleFilter struct {
	TenantID      string
	UserID        string
	Protocol      string
	Statuses      []string
	GatewayID     string
	Limit         int
	Offset        int
	IncludeClosed bool
}

type SessionConsoleRecordingDTO struct {
	Exists      bool       `json:"exists"`
	ID          *string    `json:"id,omitempty"`
	Status      *string    `json:"status,omitempty"`
	Format      *string    `json:"format,omitempty"`
	CompletedAt *time.Time `json:"completedAt,omitempty"`
	FileSize    *int       `json:"fileSize,omitempty"`
	Duration    *int       `json:"duration,omitempty"`
}

type SessionConsoleDTO struct {
	ID                string                     `json:"id"`
	UserID            string                     `json:"userId"`
	Username          string                     `json:"username"`
	Email             string                     `json:"email"`
	ConnectionID      string                     `json:"connectionId"`
	ConnectionName    string                     `json:"connectionName"`
	ConnectionHost    string                     `json:"connectionHost"`
	ConnectionPort    int                        `json:"connectionPort"`
	GatewayID         *string                    `json:"gatewayId"`
	GatewayName       *string                    `json:"gatewayName"`
	InstanceID        *string                    `json:"instanceId"`
	InstanceName      *string                    `json:"instanceName"`
	Protocol          string                     `json:"protocol"`
	Status            string                     `json:"status"`
	StartedAt         time.Time                  `json:"startedAt"`
	LastActivityAt    time.Time                  `json:"lastActivityAt"`
	EndedAt           *time.Time                 `json:"endedAt"`
	DurationFormatted string                     `json:"durationFormatted"`
	Recording         SessionConsoleRecordingDTO `json:"recording"`
}

func (s *Store) ListSessionConsoleSessions(ctx context.Context, filters SessionConsoleFilter) ([]SessionConsoleDTO, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	whereSQL, args := buildSessionConsoleWhere(filters)
	args = append(args, filters.Limit, filters.Offset)
	rows, err := s.db.Query(ctx, `SELECT s.id,
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
	        s."endedAt",
	        rec.id,
	        rec.status,
	        rec.format,
	        rec."fileSize",
	        rec.duration,
	        rec."completedAt"
	   FROM "ActiveSession" s
	   JOIN "User" u ON u.id = s."userId"
	   JOIN "Connection" c ON c.id = s."connectionId"
	   LEFT JOIN "Gateway" g ON g.id = s."gatewayId"
	   LEFT JOIN "ManagedGatewayInstance" i ON i.id = s."instanceId"
	   LEFT JOIN LATERAL (
	       SELECT sr.id,
	              sr.status::text AS status,
	              sr.format,
	              sr."fileSize",
	              sr.duration,
	              sr."completedAt"
	         FROM "SessionRecording" sr
	        WHERE sr."sessionId" = s.id
	        ORDER BY sr."createdAt" DESC
	        LIMIT 1
	   ) rec ON TRUE
	 `+whereSQL+`
	  ORDER BY COALESCE(s."endedAt", s."lastActivityAt", s."startedAt") DESC
	  LIMIT $`+fmt.Sprintf("%d", len(args)-1)+` OFFSET $`+fmt.Sprintf("%d", len(args)), args...)
	if err != nil {
		return nil, fmt.Errorf("list session console sessions: %w", err)
	}
	defer rows.Close()

	items := make([]SessionConsoleDTO, 0)
	now := time.Now()
	for rows.Next() {
		item, err := scanSessionConsoleRow(rows, now)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate session console sessions: %w", err)
	}
	return items, nil
}

func (s *Store) CountSessionConsoleSessions(ctx context.Context, filters SessionConsoleFilter) (int, error) {
	if s.db == nil {
		return 0, errors.New("postgres is not configured")
	}

	whereSQL, args := buildSessionConsoleWhere(filters)
	var count int
	if err := s.db.QueryRow(ctx, `SELECT COUNT(*)::int
	   FROM "ActiveSession" s
	 `+whereSQL, args...).Scan(&count); err != nil {
		return 0, fmt.Errorf("count session console sessions: %w", err)
	}
	return count, nil
}

func buildSessionConsoleWhere(filters SessionConsoleFilter) (string, []any) {
	args := make([]any, 0, 6)
	conditions := make([]string, 0, 6)

	args = append(args, filters.TenantID)
	conditions = append(conditions, fmt.Sprintf(`s."tenantId" = $%d`, len(args)))
	if filters.UserID != "" {
		args = append(args, filters.UserID)
		conditions = append(conditions, fmt.Sprintf(`s."userId" = $%d`, len(args)))
	}
	if filters.Protocol != "" {
		args = append(args, filters.Protocol)
		conditions = append(conditions, fmt.Sprintf(`s.protocol = $%d::"SessionProtocol"`, len(args)))
	}
	if len(filters.Statuses) > 0 {
		placeholders := make([]string, 0, len(filters.Statuses))
		for _, status := range filters.Statuses {
			args = append(args, status)
			placeholders = append(placeholders, fmt.Sprintf(`$%d::"SessionStatus"`, len(args)))
		}
		conditions = append(conditions, `s.status IN (`+joinConditionsWithComma(placeholders)+`)`)
	} else if !filters.IncludeClosed {
		conditions = append(conditions, `s.status <> 'CLOSED'::"SessionStatus"`)
	}
	if filters.GatewayID != "" {
		args = append(args, filters.GatewayID)
		conditions = append(conditions, fmt.Sprintf(`s."gatewayId" = $%d`, len(args)))
	}
	if len(conditions) == 0 {
		return "", args
	}
	return "WHERE " + joinConditions(conditions), args
}

func scanSessionConsoleRow(row interface{ Scan(dest ...any) error }, now time.Time) (SessionConsoleDTO, error) {
	var (
		item               SessionConsoleDTO
		recordingID        sql.NullString
		recordingStatus    sql.NullString
		recordingFormat    sql.NullString
		recordingFileSize  sql.NullInt32
		recordingDuration  sql.NullInt32
		recordingCompleted sql.NullTime
	)
	if err := row.Scan(
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
		&recordingID,
		&recordingStatus,
		&recordingFormat,
		&recordingFileSize,
		&recordingDuration,
		&recordingCompleted,
	); err != nil {
		return SessionConsoleDTO{}, fmt.Errorf("scan session console row: %w", err)
	}

	end := now
	if item.EndedAt != nil {
		end = *item.EndedAt
	}
	item.DurationFormatted = formatDuration(end.Sub(item.StartedAt).Milliseconds())
	if recordingID.Valid {
		item.Recording.Exists = true
		item.Recording.ID = &recordingID.String
	}
	if recordingStatus.Valid {
		item.Recording.Status = &recordingStatus.String
	}
	if recordingFormat.Valid {
		item.Recording.Format = &recordingFormat.String
	}
	if recordingFileSize.Valid {
		value := int(recordingFileSize.Int32)
		item.Recording.FileSize = &value
	}
	if recordingDuration.Valid {
		value := int(recordingDuration.Int32)
		item.Recording.Duration = &value
	}
	if recordingCompleted.Valid {
		value := recordingCompleted.Time
		item.Recording.CompletedAt = &value
	}
	return item, nil
}

func joinConditions(conditions []string) string {
	if len(conditions) == 0 {
		return ""
	}
	result := conditions[0]
	for i := 1; i < len(conditions); i++ {
		result += " AND " + conditions[i]
	}
	return result
}

func joinConditionsWithComma(values []string) string {
	if len(values) == 0 {
		return ""
	}
	result := values[0]
	for i := 1; i < len(values); i++ {
		result += ", " + values[i]
	}
	return result
}
