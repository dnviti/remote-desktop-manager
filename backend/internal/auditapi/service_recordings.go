package auditapi

import (
	"context"
	"database/sql"
)

func (s Service) GetSessionRecording(ctx context.Context, sessionID string, access sessionRecordingAccess) (sessionRecordingResponse, error) {
	args := []any{sessionID}
	conditions := []string{`r."sessionId" = $1`}
	conditions = append(conditions, access.clauses(&args, "r", "sess")...)
	row := s.DB.QueryRow(ctx, `
SELECT
	r.id,
	r."sessionId",
	r."userId",
	r."connectionId",
	r.protocol::text,
	r."filePath",
	r."fileSize",
	r.duration,
	r.width,
	r.height,
	r.format,
	r.status::text,
	r."createdAt",
	r."completedAt",
	c.id,
	c.name,
	c.type::text,
	c.host,
	c.port
FROM "SessionRecording" r
LEFT JOIN "ActiveSession" sess ON sess.id = r."sessionId"
JOIN "Connection" c ON c.id = r."connectionId"
WHERE `+joinRecordingAccessConditions(conditions)+`
ORDER BY r."createdAt" DESC
LIMIT 1
`, args...)

	var (
		item           sessionRecordingResponse
		sessionValue   sql.NullString
		fileSize       sql.NullInt32
		duration       sql.NullInt32
		width          sql.NullInt32
		height         sql.NullInt32
		completedAt    sql.NullTime
		connectionID   string
		connectionName string
		connectionType string
		connectionHost string
		connectionPort int
	)
	if err := row.Scan(
		&item.ID,
		&sessionValue,
		&item.UserID,
		&item.ConnectionID,
		&item.Protocol,
		&item.FilePath,
		&fileSize,
		&duration,
		&width,
		&height,
		&item.Format,
		&item.Status,
		&item.CreatedAt,
		&completedAt,
		&connectionID,
		&connectionName,
		&connectionType,
		&connectionHost,
		&connectionPort,
	); err != nil {
		return sessionRecordingResponse{}, err
	}

	if sessionValue.Valid {
		item.SessionID = &sessionValue.String
	}
	if fileSize.Valid {
		value := int(fileSize.Int32)
		item.FileSize = &value
	}
	if duration.Valid {
		value := int(duration.Int32)
		item.Duration = &value
	}
	if width.Valid {
		value := int(width.Int32)
		item.Width = &value
	}
	if height.Valid {
		value := int(height.Int32)
		item.Height = &value
	}
	if completedAt.Valid {
		value := completedAt.Time
		item.CompletedAt = &value
	}
	item.Connection = map[string]any{
		"id":   connectionID,
		"name": connectionName,
		"type": connectionType,
		"host": connectionHost,
		"port": connectionPort,
	}
	return item, nil
}
