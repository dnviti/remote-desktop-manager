package auditapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func parseAuditQuery(r *http.Request) (auditQuery, error) {
	query := auditQuery{
		Page:      1,
		Limit:     50,
		SortBy:    "createdAt",
		SortOrder: "desc",
	}
	values := r.URL.Query()
	if raw := strings.TrimSpace(values.Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return auditQuery{}, fmt.Errorf("page must be a positive integer")
		}
		query.Page = value
	}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return auditQuery{}, fmt.Errorf("limit must be between 1 and 100")
		}
		query.Limit = value
	}
	if raw := strings.TrimSpace(values.Get("action")); raw != "" {
		query.Action = &raw
	}
	if raw := strings.TrimSpace(values.Get("startDate")); raw != "" {
		value, err := parseAuditTime(raw)
		if err != nil {
			return auditQuery{}, fmt.Errorf("invalid startDate")
		}
		query.StartDate = &value
	}
	if raw := strings.TrimSpace(values.Get("endDate")); raw != "" {
		value, err := parseAuditTime(raw)
		if err != nil {
			return auditQuery{}, fmt.Errorf("invalid endDate")
		}
		query.EndDate = &value
	}
	query.Search = strings.TrimSpace(values.Get("search"))
	query.TargetType = strings.TrimSpace(values.Get("targetType"))
	query.IPAddress = strings.TrimSpace(values.Get("ipAddress"))
	query.GatewayID = strings.TrimSpace(values.Get("gatewayId"))
	query.GeoCountry = strings.TrimSpace(values.Get("geoCountry"))
	query.UserID = strings.TrimSpace(values.Get("userId"))
	if raw := strings.TrimSpace(values.Get("sortBy")); raw != "" {
		if raw != "createdAt" && raw != "action" {
			return auditQuery{}, fmt.Errorf("sortBy must be createdAt or action")
		}
		query.SortBy = raw
	}
	if raw := strings.TrimSpace(values.Get("sortOrder")); raw != "" {
		lower := strings.ToLower(raw)
		if lower != "asc" && lower != "desc" {
			return auditQuery{}, fmt.Errorf("sortOrder must be asc or desc")
		}
		query.SortOrder = lower
	}
	if raw := strings.TrimSpace(values.Get("flaggedOnly")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return auditQuery{}, fmt.Errorf("flaggedOnly must be a boolean")
		}
		query.FlaggedOnly = value
	}
	return query, nil
}

func parseAuditTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339, time.DateOnly} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}

func buildAuditFilters(alias string, query auditQuery, startIndex int) (string, []any) {
	clauses := make([]string, 0)
	args := make([]any, 0)
	add := func(clause string, value any) {
		clauses = append(clauses, fmt.Sprintf(clause, startIndex+len(args)))
		args = append(args, value)
	}

	if query.UserID != "" {
		add(alias+`."userId" = $%d`, query.UserID)
	}
	if query.Action != nil {
		add(alias+`.action::text = $%d`, *query.Action)
	}
	if query.StartDate != nil {
		add(alias+`."createdAt" >= $%d`, *query.StartDate)
	}
	if query.EndDate != nil {
		add(alias+`."createdAt" <= $%d`, *query.EndDate)
	}
	if query.TargetType != "" {
		add(alias+`."targetType" = $%d`, query.TargetType)
	}
	if query.IPAddress != "" {
		add(alias+`."ipAddress" ILIKE $%d`, "%"+query.IPAddress+"%")
	}
	if query.GatewayID != "" {
		add(alias+`."gatewayId" = $%d`, query.GatewayID)
	}
	if query.GeoCountry != "" {
		add(alias+`."geoCountry" = $%d`, query.GeoCountry)
	}
	if query.FlaggedOnly {
		clauses = append(clauses, fmt.Sprintf("cardinality(%s.flags) > 0", alias))
	}
	if query.Search != "" {
		term := "%" + query.Search + "%"
		index := startIndex + len(args)
		clauses = append(clauses, fmt.Sprintf(`(
COALESCE(%s."targetType", '') ILIKE $%d
OR COALESCE(%s."targetId", '') ILIKE $%d
OR COALESCE(%s."ipAddress", '') ILIKE $%d
OR COALESCE(%s.details::text, '') ILIKE $%d
)`, alias, index, alias, index, alias, index, alias, index))
		args = append(args, term)
	}

	if len(clauses) == 0 {
		return "", args
	}
	return " AND " + strings.Join(clauses, " AND "), args
}

func orderByClause(query auditQuery) string {
	field := `a."createdAt"`
	if query.SortBy == "action" {
		field = "a.action"
	}
	order := "DESC"
	if strings.EqualFold(query.SortOrder, "asc") {
		order = "ASC"
	}
	return fmt.Sprintf(" ORDER BY %s %s", field, order)
}

func collectAuditLogs(rows pgxRows) ([]auditLogEntry, error) {
	items := make([]auditLogEntry, 0)
	for rows.Next() {
		item, err := scanAuditLog(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit logs: %w", err)
	}
	return items, nil
}

func collectTenantAuditLogs(rows pgxRows) ([]tenantAuditLogEntry, error) {
	items := make([]tenantAuditLogEntry, 0)
	for rows.Next() {
		var (
			item       tenantAuditLogEntry
			details    []byte
			targetType *string
			targetID   *string
			ipAddress  *string
			gatewayID  *string
			geoCountry *string
			geoCity    *string
			userID     *string
			username   *string
			email      *string
		)
		if err := rows.Scan(
			&item.ID,
			&userID,
			&username,
			&email,
			&item.Action,
			&targetType,
			&targetID,
			&details,
			&ipAddress,
			&gatewayID,
			&geoCountry,
			&geoCity,
			&item.GeoCoords,
			&item.Flags,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tenant audit log: %w", err)
		}
		item.UserID = userID
		item.UserName = username
		item.UserEmail = email
		item.TargetType = targetType
		item.TargetID = targetID
		item.Details = json.RawMessage(details)
		item.IPAddress = ipAddress
		item.GatewayID = gatewayID
		item.GeoCountry = geoCountry
		item.GeoCity = geoCity
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant audit logs: %w", err)
	}
	return items, nil
}

func scanAuditLog(rows interface{ Scan(dest ...any) error }) (auditLogEntry, error) {
	var (
		item       auditLogEntry
		details    []byte
		targetType *string
		targetID   *string
		ipAddress  *string
		gatewayID  *string
		geoCountry *string
		geoCity    *string
	)
	if err := rows.Scan(
		&item.ID,
		&item.Action,
		&targetType,
		&targetID,
		&details,
		&ipAddress,
		&gatewayID,
		&geoCountry,
		&geoCity,
		&item.GeoCoords,
		&item.Flags,
		&item.CreatedAt,
	); err != nil {
		return auditLogEntry{}, fmt.Errorf("scan audit log: %w", err)
	}
	item.TargetType = targetType
	item.TargetID = targetID
	item.Details = json.RawMessage(details)
	item.IPAddress = ipAddress
	item.GatewayID = gatewayID
	item.GeoCountry = geoCountry
	item.GeoCity = geoCity
	return item, nil
}

func totalPages(total, limit int) int {
	if total == 0 {
		return 0
	}
	return (total + limit - 1) / limit
}

func collectGateways(rows pgxRows) ([]auditGateway, error) {
	items := make([]auditGateway, 0)
	for rows.Next() {
		var (
			id   string
			name *string
		)
		if err := rows.Scan(&id, &name); err != nil {
			return nil, fmt.Errorf("scan audit gateway: %w", err)
		}
		displayName := fmt.Sprintf("Deleted (%s...)", id[:minInt(len(id), 8)])
		if name != nil && strings.TrimSpace(*name) != "" {
			displayName = *name
		}
		items = append(items, auditGateway{ID: id, Name: displayName})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate audit gateways: %w", err)
	}
	return items, nil
}

type pgxRows interface {
	Next() bool
	Scan(dest ...any) error
	Err() error
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
