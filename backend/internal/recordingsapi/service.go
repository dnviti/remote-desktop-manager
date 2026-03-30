package recordingsapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB                    *pgxpool.Pool
	RecordingPath         string
	GuacencServiceURL     string
	GuacencUseTLS         bool
	GuacencTLSCA          string
	GuacencAuthToken      string
	GuacencTimeout        time.Duration
	GuacencRecordingPath  string
	AsciicastConverterURL string
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type recordingConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Host string `json:"host"`
}

type recordingUser struct {
	ID       string  `json:"id"`
	Email    string  `json:"email"`
	Username *string `json:"username"`
}

type recordingResponse struct {
	ID           string              `json:"id"`
	SessionID    *string             `json:"sessionId"`
	UserID       string              `json:"userId"`
	ConnectionID string              `json:"connectionId"`
	Protocol     string              `json:"protocol"`
	FilePath     string              `json:"filePath"`
	FileSize     *int                `json:"fileSize"`
	Duration     *int                `json:"duration"`
	Width        *int                `json:"width"`
	Height       *int                `json:"height"`
	Format       string              `json:"format"`
	Status       string              `json:"status"`
	CreatedAt    time.Time           `json:"createdAt"`
	CompletedAt  *time.Time          `json:"completedAt"`
	Connection   recordingConnection `json:"connection"`
	User         *recordingUser      `json:"user,omitempty"`
}

type recordingsResponse struct {
	Recordings []recordingResponse `json:"recordings"`
	Total      int                 `json:"total"`
}

type auditTrailEntry struct {
	ID         string          `json:"id"`
	UserID     *string         `json:"userId"`
	Action     string          `json:"action"`
	TargetType *string         `json:"targetType"`
	TargetID   *string         `json:"targetId"`
	Details    json.RawMessage `json:"details"`
	IPAddress  *string         `json:"ipAddress"`
	GatewayID  *string         `json:"gatewayId"`
	GeoCountry *string         `json:"geoCountry"`
	GeoCity    *string         `json:"geoCity"`
	GeoCoords  []float64       `json:"geoCoords"`
	Flags      []string        `json:"flags"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type auditTrailResponse struct {
	Data    []auditTrailEntry `json:"data"`
	HasMore bool              `json:"hasMore"`
}

type listQuery struct {
	ConnectionID *string
	Protocol     *string
	Status       *string
	Limit        int
	Offset       int
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	query, err := parseListQuery(r)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.ListRecordings(r.Context(), claims, query)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, "RECORDING_VIEW", item.ID, map[string]any{
		"recordingId":  item.ID,
		"protocol":     item.Protocol,
		"connectionId": item.ConnectionID,
	}, requestIP(r))
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleAuditTrail(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetAuditTrail(r.Context(), r.PathValue("id"), claims)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	deleted, err := s.DeleteRecording(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !deleted {
		app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, "RECORDING_DELETE", r.PathValue("id"), map[string]any{
		"recordingId": r.PathValue("id"),
	}, requestIP(r))
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) ListRecordings(ctx context.Context, claims authn.Claims, query listQuery) (recordingsResponse, error) {
	if s.DB == nil {
		return recordingsResponse{}, fmt.Errorf("database is unavailable")
	}
	args := make([]any, 0, 8)
	conditions := make([]string, 0, 4)
	baseSQL := `
FROM "SessionRecording" sr
JOIN "Connection" c ON c.id = sr."connectionId"
JOIN "User" u ON u.id = sr."userId"
`
	if strings.TrimSpace(claims.TenantID) != "" {
		args = append(args, claims.TenantID)
		baseSQL += fmt.Sprintf(`JOIN "TenantMember" tm ON tm."userId" = sr."userId" AND tm."tenantId" = $%d AND tm."isActive" = true `, len(args))
	} else {
		args = append(args, claims.UserID)
		conditions = append(conditions, fmt.Sprintf(`sr."userId" = $%d`, len(args)))
	}

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

func (s Service) GetRecording(ctx context.Context, recordingID, userID string) (recordingResponse, error) {
	if _, err := uuid.Parse(strings.TrimSpace(recordingID)); err != nil {
		return recordingResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid recording id"}
	}
	row := s.DB.QueryRow(ctx, `
SELECT sr.id, sr."sessionId", sr."userId", sr."connectionId", sr.protocol::text, sr."filePath",
       sr."fileSize", sr.duration, sr.width, sr.height, sr.format, sr.status::text,
       sr."createdAt", sr."completedAt",
       c.id, c.name, c.type::text, c.host
FROM "SessionRecording" sr
JOIN "Connection" c ON c.id = sr."connectionId"
WHERE sr.id = $1 AND sr."userId" = $2
`, recordingID, userID)
	return scanRecording(row, false)
}

func (s Service) GetAuditTrail(ctx context.Context, recordingID string, claims authn.Claims) (auditTrailResponse, error) {
	if _, err := uuid.Parse(strings.TrimSpace(recordingID)); err != nil {
		return auditTrailResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid recording id"}
	}

	var (
		sessionID sql.NullString
		userID    string
	)
	err := s.DB.QueryRow(ctx, `SELECT "sessionId", "userId" FROM "SessionRecording" WHERE id = $1`, recordingID).Scan(&sessionID, &userID)
	if err != nil {
		return auditTrailResponse{}, err
	}

	isOwner := userID == claims.UserID
	isAuditor := strings.TrimSpace(claims.TenantID) != "" && hasAnyRole(claims.TenantRole, "ADMIN", "OWNER", "AUDITOR")
	if !isOwner && !isAuditor {
		return auditTrailResponse{}, pgx.ErrNoRows
	}
	if !sessionID.Valid {
		return auditTrailResponse{Data: []auditTrailEntry{}, HasMore: false}, nil
	}

	args := []any{recordingID, sessionID.String}
	conditions := []string{`((details ->> 'sessionId') = $2 OR (details ->> 'recordingId') = $1)`}
	if !isAuditor {
		args = append(args, claims.UserID)
		conditions = append(conditions, fmt.Sprintf(`"userId" = $%d`, len(args)))
	}
	querySQL := `
SELECT id, "userId", action::text, "targetType", "targetId",
       CASE WHEN details IS NULL THEN NULL ELSE details::text END,
       "ipAddress", "gatewayId", "geoCountry", "geoCity", "geoCoords", flags, "createdAt"
FROM "AuditLog"
WHERE ` + strings.Join(conditions, " AND ") + `
ORDER BY "createdAt" ASC
LIMIT 201
`
	rows, err := s.DB.Query(ctx, querySQL, args...)
	if err != nil {
		return auditTrailResponse{}, fmt.Errorf("list audit trail: %w", err)
	}
	defer rows.Close()

	items := make([]auditTrailEntry, 0)
	for rows.Next() {
		var (
			item       auditTrailEntry
			userIDText sql.NullString
			targetType sql.NullString
			targetID   sql.NullString
			details    sql.NullString
			ipAddress  sql.NullString
			gatewayID  sql.NullString
			geoCountry sql.NullString
			geoCity    sql.NullString
			geoCoords  []float64
			flags      []string
		)
		if err := rows.Scan(&item.ID, &userIDText, &item.Action, &targetType, &targetID, &details, &ipAddress, &gatewayID, &geoCountry, &geoCity, &geoCoords, &flags, &item.CreatedAt); err != nil {
			return auditTrailResponse{}, fmt.Errorf("scan audit trail: %w", err)
		}
		if userIDText.Valid {
			item.UserID = &userIDText.String
		}
		if targetType.Valid {
			item.TargetType = &targetType.String
		}
		if targetID.Valid {
			item.TargetID = &targetID.String
		}
		if details.Valid {
			item.Details = json.RawMessage(details.String)
		}
		if ipAddress.Valid {
			item.IPAddress = &ipAddress.String
		}
		if gatewayID.Valid {
			item.GatewayID = &gatewayID.String
		}
		if geoCountry.Valid {
			item.GeoCountry = &geoCountry.String
		}
		if geoCity.Valid {
			item.GeoCity = &geoCity.String
		}
		item.GeoCoords = geoCoords
		item.Flags = flags
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return auditTrailResponse{}, fmt.Errorf("iterate audit trail: %w", err)
	}

	hasMore := len(items) > 200
	if hasMore {
		items = items[:200]
	}
	return auditTrailResponse{Data: items, HasMore: hasMore}, nil
}

func (s Service) DeleteRecording(ctx context.Context, recordingID, userID string) (bool, error) {
	if _, err := uuid.Parse(strings.TrimSpace(recordingID)); err != nil {
		return false, &requestError{status: http.StatusBadRequest, message: "invalid recording id"}
	}
	var (
		filePath sql.NullString
		format   sql.NullString
	)
	err := s.DB.QueryRow(ctx, `SELECT "filePath", format FROM "SessionRecording" WHERE id = $1 AND "userId" = $2`, recordingID, userID).Scan(&filePath, &format)
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
	tag, err := s.DB.Exec(ctx, `DELETE FROM "SessionRecording" WHERE id = $1 AND "userId" = $2`, recordingID, userID)
	if err != nil {
		return false, fmt.Errorf("delete recording: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

func parseListQuery(r *http.Request) (listQuery, error) {
	query := listQuery{Limit: 50, Offset: 0}
	if value := strings.TrimSpace(r.URL.Query().Get("connectionId")); value != "" {
		if _, err := uuid.Parse(value); err != nil {
			return listQuery{}, &requestError{status: http.StatusBadRequest, message: "connectionId must be a valid UUID"}
		}
		query.ConnectionID = &value
	}
	if value := strings.TrimSpace(r.URL.Query().Get("protocol")); value != "" {
		switch value {
		case "SSH", "RDP", "VNC", "DATABASE":
		default:
			return listQuery{}, &requestError{status: http.StatusBadRequest, message: "protocol must be SSH, RDP, VNC, or DATABASE"}
		}
		query.Protocol = &value
	}
	if value := strings.TrimSpace(r.URL.Query().Get("status")); value != "" {
		switch value {
		case "RECORDING", "COMPLETE", "ERROR":
		default:
			return listQuery{}, &requestError{status: http.StatusBadRequest, message: "status must be RECORDING, COMPLETE, or ERROR"}
		}
		query.Status = &value
	}
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 100 {
			return listQuery{}, &requestError{status: http.StatusBadRequest, message: "limit must be between 1 and 100"}
		}
		query.Limit = parsed
	}
	if value := strings.TrimSpace(r.URL.Query().Get("offset")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			return listQuery{}, &requestError{status: http.StatusBadRequest, message: "offset must be 0 or greater"}
		}
		query.Offset = parsed
	}
	return query, nil
}

func scanRecording(row interface{ Scan(dest ...any) error }, includeUser bool) (recordingResponse, error) {
	var (
		item        recordingResponse
		sessionID   sql.NullString
		fileSize    sql.NullInt32
		duration    sql.NullInt32
		width       sql.NullInt32
		height      sql.NullInt32
		completedAt sql.NullTime
		user        recordingUser
		username    sql.NullString
	)
	dest := []any{
		&item.ID,
		&sessionID,
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
		&item.Connection.ID,
		&item.Connection.Name,
		&item.Connection.Type,
		&item.Connection.Host,
	}
	if includeUser {
		dest = append(dest, &user.ID, &user.Email, &username)
	}
	if err := row.Scan(dest...); err != nil {
		return recordingResponse{}, err
	}
	if sessionID.Valid {
		item.SessionID = &sessionID.String
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
		item.CompletedAt = &completedAt.Time
	}
	if includeUser {
		if username.Valid {
			user.Username = &username.String
		}
		item.User = &user
	}
	return item, nil
}

func hasAnyRole(role string, allowed ...string) bool {
	for _, candidate := range allowed {
		if role == candidate {
			return true
		}
	}
	return false
}

func requestIP(r *http.Request) string {
	if value := strings.TrimSpace(r.Header.Get("X-Real-IP")); value != "" {
		return value
	}
	if value := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); value != "" {
		parts := strings.Split(value, ",")
		if len(parts) > 0 {
			return strings.TrimSpace(parts[0])
		}
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any, ipAddress string) error {
	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	var ip *string
	if strings.TrimSpace(ipAddress) != "" {
		ip = &ipAddress
	}
	_, err = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3, 'Recording', $4, $5::jsonb, $6)
`, uuid.NewString(), userID, action, targetID, string(detailsJSON), ip)
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}
