package recordingsapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) ListRecordings(ctx context.Context, claims authn.Claims, query listQuery) (recordingsResponse, error) {
	if s.DB == nil {
		return recordingsResponse{}, fmt.Errorf("database is unavailable")
	}
	visibility, err := s.resolveRecordingVisibility(ctx, claims)
	if err != nil {
		return recordingsResponse{}, err
	}
	args := make([]any, 0, 8)
	conditions := []string{`sr.protocol <> 'DATABASE'::"SessionProtocol"`}
	baseSQL := `
FROM "SessionRecording" sr
LEFT JOIN "ActiveSession" sess ON sess.id = sr."sessionId"
JOIN "Connection" c ON c.id = sr."connectionId"
LEFT JOIN "Team" team_scope ON team_scope.id = c."teamId"
JOIN "User" u ON u.id = sr."userId"
`
	conditions = append(conditions, visibility.clauses(&args, "sr", recordingTenantScopeSQL)...)

	if query.ConnectionID != nil {
		args = append(args, *query.ConnectionID)
		conditions = append(conditions, fmt.Sprintf(`sr."connectionId" = $%d`, len(args)))
	}
	if query.Protocol != nil {
		args = append(args, *query.Protocol)
		conditions = append(conditions, fmt.Sprintf(`sr.protocol::text = $%d`, len(args)))
	}
	if query.Status != nil {
		args = append(args, *query.Status)
		conditions = append(conditions, fmt.Sprintf(`sr.status::text = $%d`, len(args)))
	}

	whereSQL := ""
	if len(conditions) > 0 {
		whereSQL = "WHERE " + strings.Join(conditions, " AND ")
	}

	countSQL := `SELECT COUNT(*)::int ` + baseSQL + whereSQL
	var total int
	if err := s.DB.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return recordingsResponse{}, fmt.Errorf("count recordings: %w", err)
	}

	args = append(args, query.Limit, query.Offset)
	querySQL := `
SELECT sr.id, sr."sessionId", sr."userId", sr."connectionId", sr.protocol::text, sr."filePath",
       sr."fileSize", sr.duration, sr.width, sr.height, sr.format, sr.status::text,
       sr."createdAt", sr."completedAt",
       c.id, c.name, c.type::text, c.host,
       u.id, u.email, u.username
` + baseSQL + whereSQL + fmt.Sprintf(`
ORDER BY sr."createdAt" DESC
LIMIT $%d OFFSET $%d
`, len(args)-1, len(args))

	rows, err := s.DB.Query(ctx, querySQL, args...)
	if err != nil {
		return recordingsResponse{}, fmt.Errorf("list recordings: %w", err)
	}
	defer rows.Close()

	items := make([]recordingResponse, 0)
	for rows.Next() {
		item, err := scanRecording(rows, true)
		if err != nil {
			return recordingsResponse{}, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return recordingsResponse{}, fmt.Errorf("iterate recordings: %w", err)
	}
	return recordingsResponse{Recordings: items, Total: total}, nil
}

func (s Service) GetRecording(ctx context.Context, recordingID string, claims authn.Claims) (recordingResponse, error) {
	if _, err := uuid.Parse(strings.TrimSpace(recordingID)); err != nil {
		return recordingResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid recording id"}
	}
	visibility, err := s.resolveRecordingVisibility(ctx, claims)
	if err != nil {
		return recordingResponse{}, err
	}
	args := []any{recordingID}
	conditions := []string{`sr.id = $1`}
	conditions = append(conditions, visibility.clauses(&args, "sr", recordingTenantScopeSQL)...)
	row := s.DB.QueryRow(ctx, `
SELECT sr.id, sr."sessionId", sr."userId", sr."connectionId", sr.protocol::text, sr."filePath",
       sr."fileSize", sr.duration, sr.width, sr.height, sr.format, sr.status::text,
       sr."createdAt", sr."completedAt",
       c.id, c.name, c.type::text, c.host
FROM "SessionRecording" sr
LEFT JOIN "ActiveSession" sess ON sess.id = sr."sessionId"
JOIN "Connection" c ON c.id = sr."connectionId"
LEFT JOIN "Team" team_scope ON team_scope.id = c."teamId"
WHERE `+joinConditions(conditions)+`
`, args...)
	return scanRecording(row, false)
}

func (s Service) DeleteRecording(ctx context.Context, recordingID string, claims authn.Claims) (bool, error) {
	if _, err := uuid.Parse(strings.TrimSpace(recordingID)); err != nil {
		return false, &requestError{status: http.StatusBadRequest, message: "invalid recording id"}
	}
	visibility, err := s.resolveRecordingVisibility(ctx, claims)
	if err != nil {
		return false, err
	}
	if !visibility.canDelete() {
		return false, &requestError{status: http.StatusForbidden, message: "Forbidden"}
	}
	args := []any{recordingID}
	conditions := []string{`sr.id = $1`}
	conditions = append(conditions, visibility.clauses(&args, "sr", recordingTenantScopeSQL)...)
	var (
		filePath sql.NullString
		format   sql.NullString
	)
	err = s.DB.QueryRow(ctx, `
SELECT sr."filePath", sr.format
FROM "SessionRecording" sr
LEFT JOIN "ActiveSession" sess ON sess.id = sr."sessionId"
JOIN "Connection" c ON c.id = sr."connectionId"
LEFT JOIN "Team" team_scope ON team_scope.id = c."teamId"
WHERE `+joinConditions(conditions), args...).Scan(&filePath, &format)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("load recording for delete: %w", err)
	}
	if filePath.Valid {
		_ = os.Remove(filePath.String)
		switch format.String {
		case "guac":
			_ = os.Remove(filePath.String + ".m4v")
		case "asciicast":
			_ = os.Remove(filePath.String + ".mp4")
		}
	}
	tag, err := s.DB.Exec(ctx, `DELETE FROM "SessionRecording" WHERE id = $1`, recordingID)
	if err != nil {
		return false, fmt.Errorf("delete recording: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
