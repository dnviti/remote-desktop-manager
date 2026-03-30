package auditapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB         *pgxpool.Pool
	TenantAuth tenantauth.Service
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string { return e.message }

type auditGateway struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type geoSummaryPoint struct {
	Lat      float64   `json:"lat"`
	Lng      float64   `json:"lng"`
	Country  string    `json:"country"`
	City     string    `json:"city"`
	Count    int       `json:"count"`
	LastSeen time.Time `json:"lastSeen"`
}

type auditLogEntry struct {
	ID         string          `json:"id"`
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

type tenantAuditLogEntry struct {
	auditLogEntry
	UserID    *string `json:"userId"`
	UserName  *string `json:"userName"`
	UserEmail *string `json:"userEmail"`
}

type paginatedAuditLogs struct {
	Data       []auditLogEntry `json:"data"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	Limit      int             `json:"limit"`
	TotalPages int             `json:"totalPages"`
}

type paginatedTenantAuditLogs struct {
	Data       []tenantAuditLogEntry `json:"data"`
	Total      int                   `json:"total"`
	Page       int                   `json:"page"`
	Limit      int                   `json:"limit"`
	TotalPages int                   `json:"totalPages"`
}

type connectionAuditUser struct {
	ID       string  `json:"id"`
	Username *string `json:"username"`
	Email    string  `json:"email"`
}

type sessionRecordingResponse struct {
	ID           string     `json:"id"`
	SessionID    *string    `json:"sessionId"`
	UserID       string     `json:"userId"`
	ConnectionID string     `json:"connectionId"`
	Protocol     string     `json:"protocol"`
	FilePath     string     `json:"filePath"`
	FileSize     *int       `json:"fileSize"`
	Duration     *int       `json:"duration"`
	Width        *int       `json:"width"`
	Height       *int       `json:"height"`
	Format       string     `json:"format"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	CompletedAt  *time.Time `json:"completedAt"`
	Connection   any        `json:"connection"`
}

type auditQuery struct {
	Page        int
	Limit       int
	Action      *string
	StartDate   *time.Time
	EndDate     *time.Time
	Search      string
	TargetType  string
	IPAddress   string
	GatewayID   string
	GeoCountry  string
	SortBy      string
	SortOrder   string
	FlaggedOnly bool
	UserID      string
}

func (s Service) ListGateways(ctx context.Context, userID string) ([]auditGateway, error) {
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT a."gatewayId", g.name
FROM "AuditLog" a
LEFT JOIN "Gateway" g ON g.id = a."gatewayId"
WHERE a."userId" = $1
  AND a."gatewayId" IS NOT NULL
ORDER BY a."gatewayId" ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("list audit gateways: %w", err)
	}
	defer rows.Close()
	return collectGateways(rows)
}

func (s Service) GetSessionRecording(ctx context.Context, sessionID string) (sessionRecordingResponse, error) {
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
JOIN "Connection" c ON c.id = r."connectionId"
WHERE r."sessionId" = $1
ORDER BY r."createdAt" DESC
LIMIT 1
`, sessionID)

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

func (s Service) ListCountries(ctx context.Context, userID string) ([]string, error) {
	return s.listCountriesByQuery(ctx, `
SELECT DISTINCT "geoCountry"
FROM "AuditLog"
WHERE "userId" = $1
  AND "geoCountry" IS NOT NULL
ORDER BY "geoCountry" ASC
`, userID)
}

func (s Service) ListTenantGateways(ctx context.Context, tenantID string) ([]auditGateway, error) {
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT a."gatewayId", g.name
FROM "AuditLog" a
JOIN "TenantMember" tm ON tm."userId" = a."userId"
LEFT JOIN "Gateway" g ON g.id = a."gatewayId"
WHERE tm."tenantId" = $1
  AND a."gatewayId" IS NOT NULL
ORDER BY a."gatewayId" ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant audit gateways: %w", err)
	}
	defer rows.Close()
	return collectGateways(rows)
}

func (s Service) ListTenantCountries(ctx context.Context, tenantID string) ([]string, error) {
	return s.listCountriesByQuery(ctx, `
SELECT DISTINCT a."geoCountry"
FROM "AuditLog" a
JOIN "TenantMember" tm ON tm."userId" = a."userId"
WHERE tm."tenantId" = $1
  AND a."geoCountry" IS NOT NULL
ORDER BY a."geoCountry" ASC
`, tenantID)
}

func (s Service) GetTenantGeoSummary(ctx context.Context, tenantID string, days int) ([]geoSummaryPoint, error) {
	rows, err := s.DB.Query(ctx, `
SELECT a."geoCountry", COALESCE(a."geoCity", ''), a."geoCoords", COUNT(*)::int, MAX(a."createdAt")
FROM "AuditLog" a
JOIN "TenantMember" tm ON tm."userId" = a."userId"
WHERE tm."tenantId" = $1
  AND a."geoCountry" IS NOT NULL
  AND cardinality(a."geoCoords") >= 2
  AND a."createdAt" >= $2
GROUP BY a."geoCountry", a."geoCity", a."geoCoords"
ORDER BY MAX(a."createdAt") DESC
`, tenantID, time.Now().UTC().Add(-time.Duration(days)*24*time.Hour))
	if err != nil {
		return nil, fmt.Errorf("list tenant geo summary: %w", err)
	}
	defer rows.Close()

	points := make([]geoSummaryPoint, 0)
	for rows.Next() {
		var (
			item   geoSummaryPoint
			coords []float64
		)
		if err := rows.Scan(&item.Country, &item.City, &coords, &item.Count, &item.LastSeen); err != nil {
			return nil, fmt.Errorf("scan tenant geo summary: %w", err)
		}
		if len(coords) < 2 {
			continue
		}
		item.Lat = coords[0]
		item.Lng = coords[1]
		points = append(points, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant geo summary: %w", err)
	}
	return points, nil
}

func (s Service) ListAuditLogs(ctx context.Context, userID string, query auditQuery) (paginatedAuditLogs, error) {
	baseSQL, args := buildAuditFilters("a", auditQuery{UserID: userID}, 1)
	filterSQL, filterArgs := buildAuditFilters("a", query, len(args)+1)
	args = append(args, filterArgs...)

	orderBy := orderByClause(query)
	limitOffsetSQL := fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)

	rows, err := s.DB.Query(ctx, `
SELECT
	a.id,
	a.action::text,
	a."targetType",
	a."targetId",
	COALESCE(a.details, 'null'::jsonb),
	a."ipAddress",
	a."gatewayId",
	a."geoCountry",
	a."geoCity",
	a."geoCoords",
	a.flags,
	a."createdAt"
FROM "AuditLog" a
WHERE 1 = 1`+baseSQL+filterSQL+orderBy+limitOffsetSQL, append(args, query.Limit, (query.Page-1)*query.Limit)...)
	if err != nil {
		return paginatedAuditLogs{}, fmt.Errorf("list audit logs: %w", err)
	}
	defer rows.Close()

	items, err := collectAuditLogs(rows)
	if err != nil {
		return paginatedAuditLogs{}, err
	}

	var total int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "AuditLog" a WHERE 1 = 1`+baseSQL+filterSQL, args...).Scan(&total); err != nil {
		return paginatedAuditLogs{}, fmt.Errorf("count audit logs: %w", err)
	}

	return paginatedAuditLogs{
		Data:       items,
		Total:      total,
		Page:       query.Page,
		Limit:      query.Limit,
		TotalPages: totalPages(total, query.Limit),
	}, nil
}

func (s Service) ListTenantAuditLogs(ctx context.Context, tenantID string, query auditQuery) (paginatedTenantAuditLogs, error) {
	baseArgs := []any{tenantID}
	filterSQL, filterArgs := buildAuditFilters("a", query, len(baseArgs)+1)
	args := append(baseArgs, filterArgs...)
	orderBy := orderByClause(query)
	limitOffsetSQL := fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)

	rows, err := s.DB.Query(ctx, `
SELECT
	a.id,
	a."userId",
	u.username,
	u.email,
	a.action::text,
	a."targetType",
	a."targetId",
	COALESCE(a.details, 'null'::jsonb),
	a."ipAddress",
	a."gatewayId",
	a."geoCountry",
	a."geoCity",
	a."geoCoords",
	a.flags,
	a."createdAt"
FROM "AuditLog" a
JOIN "TenantMember" tm
  ON tm."userId" = a."userId"
 AND tm."tenantId" = $1
 AND tm.status = 'ACCEPTED'
LEFT JOIN "User" u ON u.id = a."userId"
WHERE 1 = 1`+filterSQL+orderBy+limitOffsetSQL, append(args, query.Limit, (query.Page-1)*query.Limit)...)
	if err != nil {
		return paginatedTenantAuditLogs{}, fmt.Errorf("list tenant audit logs: %w", err)
	}
	defer rows.Close()

	items, err := collectTenantAuditLogs(rows)
	if err != nil {
		return paginatedTenantAuditLogs{}, err
	}

	var total int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "AuditLog" a
JOIN "TenantMember" tm
  ON tm."userId" = a."userId"
 AND tm."tenantId" = $1
 AND tm.status = 'ACCEPTED'
WHERE 1 = 1`+filterSQL, args...).Scan(&total); err != nil {
		return paginatedTenantAuditLogs{}, fmt.Errorf("count tenant audit logs: %w", err)
	}

	return paginatedTenantAuditLogs{
		Data:       items,
		Total:      total,
		Page:       query.Page,
		Limit:      query.Limit,
		TotalPages: totalPages(total, query.Limit),
	}, nil
}

func (s Service) ListConnectionAuditLogs(ctx context.Context, connectionID string, query auditQuery) (paginatedTenantAuditLogs, error) {
	baseArgs := []any{connectionID}
	connectionFilter := auditQuery{
		UserID:      query.UserID,
		Action:      query.Action,
		StartDate:   query.StartDate,
		EndDate:     query.EndDate,
		Search:      query.Search,
		IPAddress:   query.IPAddress,
		GatewayID:   query.GatewayID,
		GeoCountry:  query.GeoCountry,
		SortBy:      query.SortBy,
		SortOrder:   query.SortOrder,
		FlaggedOnly: query.FlaggedOnly,
	}
	filterSQL, filterArgs := buildAuditFilters("a", connectionFilter, len(baseArgs)+1)
	args := append(baseArgs, filterArgs...)
	orderBy := orderByClause(query)
	limitOffsetSQL := fmt.Sprintf(" LIMIT $%d OFFSET $%d", len(args)+1, len(args)+2)

	rows, err := s.DB.Query(ctx, `
SELECT
	a.id,
	a."userId",
	u.username,
	u.email,
	a.action::text,
	a."targetType",
	a."targetId",
	COALESCE(a.details, 'null'::jsonb),
	a."ipAddress",
	a."gatewayId",
	a."geoCountry",
	a."geoCity",
	a."geoCoords",
	a.flags,
	a."createdAt"
FROM "AuditLog" a
LEFT JOIN "User" u ON u.id = a."userId"
WHERE a."targetId" = $1`+filterSQL+orderBy+limitOffsetSQL, append(args, query.Limit, (query.Page-1)*query.Limit)...)
	if err != nil {
		return paginatedTenantAuditLogs{}, fmt.Errorf("list connection audit logs: %w", err)
	}
	defer rows.Close()

	items, err := collectTenantAuditLogs(rows)
	if err != nil {
		return paginatedTenantAuditLogs{}, err
	}

	var total int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "AuditLog" a WHERE a."targetId" = $1`+filterSQL, args...).Scan(&total); err != nil {
		return paginatedTenantAuditLogs{}, fmt.Errorf("count connection audit logs: %w", err)
	}

	return paginatedTenantAuditLogs{
		Data:       items,
		Total:      total,
		Page:       query.Page,
		Limit:      query.Limit,
		TotalPages: totalPages(total, query.Limit),
	}, nil
}

func (s Service) ListConnectionUsers(ctx context.Context, connectionID string) ([]connectionAuditUser, error) {
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT u.id, u.username, u.email
FROM "AuditLog" a
JOIN "User" u ON u.id = a."userId"
WHERE a."targetId" = $1
  AND a."userId" IS NOT NULL
ORDER BY u.email ASC
`, connectionID)
	if err != nil {
		return nil, fmt.Errorf("list connection audit users: %w", err)
	}
	defer rows.Close()

	items := make([]connectionAuditUser, 0)
	for rows.Next() {
		var (
			item     connectionAuditUser
			username *string
		)
		if err := rows.Scan(&item.ID, &username, &item.Email); err != nil {
			return nil, fmt.Errorf("scan connection audit user: %w", err)
		}
		item.Username = username
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate connection audit users: %w", err)
	}
	return items, nil
}
