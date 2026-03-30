package dbauditapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
)

var nestedQuantifierPattern = regexp.MustCompile(`(\+|\*|\{[^}]+\})\s*\)?\s*(\+|\*|\?|\{[^}]+\})`)

func parseDBAuditQuery(r *http.Request) (dbAuditQuery, error) {
	query := dbAuditQuery{
		Page:      1,
		Limit:     50,
		SortBy:    "createdAt",
		SortOrder: "desc",
	}
	values := r.URL.Query()
	if raw := strings.TrimSpace(values.Get("page")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 {
			return dbAuditQuery{}, fmt.Errorf("page must be a positive integer")
		}
		query.Page = value
	}
	if raw := strings.TrimSpace(values.Get("limit")); raw != "" {
		value, err := strconv.Atoi(raw)
		if err != nil || value < 1 || value > 100 {
			return dbAuditQuery{}, fmt.Errorf("limit must be between 1 and 100")
		}
		query.Limit = value
	}
	query.UserID = strings.TrimSpace(values.Get("userId"))
	query.ConnectionID = strings.TrimSpace(values.Get("connectionId"))
	query.Search = strings.TrimSpace(values.Get("search"))
	if raw := strings.TrimSpace(values.Get("queryType")); raw != "" {
		raw = strings.ToUpper(raw)
		switch raw {
		case "SELECT", "INSERT", "UPDATE", "DELETE", "DDL", "OTHER":
			query.QueryType = raw
		default:
			return dbAuditQuery{}, fmt.Errorf("queryType must be SELECT, INSERT, UPDATE, DELETE, DDL, or OTHER")
		}
	}
	if raw := strings.TrimSpace(values.Get("blocked")); raw != "" {
		value, err := strconv.ParseBool(raw)
		if err != nil {
			return dbAuditQuery{}, fmt.Errorf("blocked must be a boolean")
		}
		query.Blocked = &value
	}
	if raw := strings.TrimSpace(values.Get("startDate")); raw != "" {
		value, err := parseAuditTime(raw)
		if err != nil {
			return dbAuditQuery{}, fmt.Errorf("invalid startDate")
		}
		query.StartDate = &value
	}
	if raw := strings.TrimSpace(values.Get("endDate")); raw != "" {
		value, err := parseAuditTime(raw)
		if err != nil {
			return dbAuditQuery{}, fmt.Errorf("invalid endDate")
		}
		query.EndDate = &value
	}
	if raw := strings.TrimSpace(values.Get("sortBy")); raw != "" {
		switch raw {
		case "createdAt", "queryType", "executionTimeMs":
			query.SortBy = raw
		default:
			return dbAuditQuery{}, fmt.Errorf("sortBy must be createdAt, queryType, or executionTimeMs")
		}
	}
	if raw := strings.TrimSpace(values.Get("sortOrder")); raw != "" {
		value := strings.ToLower(raw)
		if value != "asc" && value != "desc" {
			return dbAuditQuery{}, fmt.Errorf("sortOrder must be asc or desc")
		}
		query.SortOrder = value
	}
	return query, nil
}

func buildFilters(query dbAuditQuery, tenantID string) (string, []any) {
	clauses := []string{`l."tenantId" = $1`}
	args := []any{tenantID}
	add := func(clause string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(clause, len(args)))
	}

	if query.UserID != "" {
		add(`l."userId" = $%d`, query.UserID)
	}
	if query.ConnectionID != "" {
		add(`l."connectionId" = $%d`, query.ConnectionID)
	}
	if query.QueryType != "" {
		add(`l."queryType" = $%d::"DbQueryType"`, query.QueryType)
	}
	if query.Blocked != nil {
		add(`l.blocked = $%d`, *query.Blocked)
	}
	if query.StartDate != nil {
		add(`l."createdAt" >= $%d`, *query.StartDate)
	}
	if query.EndDate != nil {
		add(`l."createdAt" <= $%d`, *query.EndDate)
	}
	if query.Search != "" {
		term := strings.TrimSpace(query.Search)
		queryText := "%" + term + "%"
		blockReason := "%" + term + "%"
		tablesValue := strings.ToLower(term)
		args = append(args, queryText, tablesValue, blockReason)
		base := len(args) - 2
		clauses = append(clauses,
			fmt.Sprintf(`(l."queryText" ILIKE $%d OR EXISTS (SELECT 1 FROM unnest(l."tablesAccessed") AS t WHERE t = $%d) OR l."blockReason" ILIKE $%d)`, base, base+1, base+2),
		)
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

func orderByClause(query dbAuditQuery) string {
	column := `l."createdAt"`
	switch query.SortBy {
	case "queryType":
		column = `l."queryType"`
	case "executionTimeMs":
		column = `l."executionTimeMs"`
	}
	direction := "DESC"
	if query.SortOrder == "asc" {
		direction = "ASC"
	}
	return column + " " + direction
}

func parseAuditTime(value string) (time.Time, error) {
	for _, layout := range []string{time.RFC3339Nano, time.RFC3339, time.DateOnly} {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid time")
}

func totalPages(total, limit int) int {
	if total == 0 {
		return 0
	}
	return (total + limit - 1) / limit
}

func readRawUpdatePayload(r *http.Request) (map[string]json.RawMessage, error) {
	defer r.Body.Close()
	var payload map[string]json.RawMessage
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&payload); err != nil {
		return nil, err
	}
	if payload == nil {
		payload = map[string]json.RawMessage{}
	}
	return payload, nil
}

func validateName(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", &requestError{status: http.StatusBadRequest, message: "name is required"}
	}
	if len(name) > 200 {
		return "", &requestError{status: http.StatusBadRequest, message: "name must be 200 characters or fewer"}
	}
	return name, nil
}

func validateSafeRegex(pattern, label string) (string, error) {
	pattern = strings.TrimSpace(pattern)
	if pattern == "" {
		return "", &requestError{status: http.StatusBadRequest, message: label + " pattern is required"}
	}
	if len(pattern) > maxRegexLength || nestedQuantifierPattern.MatchString(pattern) {
		return "", &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Regex %s rejected: pattern too long or contains nested quantifiers", label)}
	}
	if _, err := regexp.Compile(pattern); err != nil {
		return "", &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("Invalid regex %s: %s", label, pattern)}
	}
	return pattern, nil
}

func normalizeFirewallAction(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "BLOCK", "ALERT", "LOG":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid firewall action"}
	}
}

func normalizeMaskingStrategy(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "REDACT", "HASH", "PARTIAL":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid masking strategy"}
	}
}

func normalizeDbQueryType(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "SELECT", "INSERT", "UPDATE", "DELETE", "DDL", "OTHER":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid db query type"}
	}
}

func normalizeOptionalDbQueryType(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	normalized, err := normalizeDbQueryType(*value)
	if err != nil {
		return nil, err
	}
	return &normalized, nil
}

func normalizeRateLimitAction(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "REJECT", "LOG_ONLY":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid rate limit action"}
	}
}

func normalizeOptionalRateLimitAction(value *string) (*string, error) {
	if value == nil {
		return nil, nil
	}
	normalized, err := normalizeRateLimitAction(*value)
	if err != nil {
		return nil, err
	}
	return &normalized, nil
}

func validateRateLimitValues(windowMS, maxQueries, burstMax *int) error {
	if windowMS != nil && *windowMS < 1 {
		return &requestError{status: http.StatusBadRequest, message: "windowMs must be at least 1"}
	}
	if maxQueries != nil && *maxQueries < 1 {
		return &requestError{status: http.StatusBadRequest, message: "maxQueries must be at least 1"}
	}
	if burstMax != nil && *burstMax < 1 {
		return &requestError{status: http.StatusBadRequest, message: "burstMax must be at least 1"}
	}
	return nil
}

func decodeString(raw json.RawMessage) (string, error) {
	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return "", err
	}
	return value, nil
}

func decodeOptionalString(raw json.RawMessage) (*string, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	value, err := decodeString(raw)
	if err != nil {
		return nil, err
	}
	return normalizeOptionalString(&value), nil
}

func decodeBool(raw json.RawMessage) (bool, error) {
	var value bool
	err := json.Unmarshal(raw, &value)
	return value, err
}

func decodeInt(raw json.RawMessage) (int, error) {
	var value int
	err := json.Unmarshal(raw, &value)
	return value, err
}

func decodeStringSlice(raw json.RawMessage) ([]string, error) {
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, err
	}
	return values, nil
}

func decodeOptionalEnumString(raw json.RawMessage, normalize func(string) (string, error)) (*string, bool, error) {
	if string(raw) == "null" {
		return nil, false, nil
	}
	value, err := decodeString(raw)
	if err != nil {
		return nil, false, err
	}
	normalized, err := normalize(value)
	if err != nil {
		return nil, false, err
	}
	return &normalized, true, nil
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func defaultBool(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func defaultInt(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func defaultString(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return *value
}

func defaultStringSlice(values []string) []string {
	if values == nil {
		return []string{}
	}
	return values
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			if value != "" {
				return &value
			}
		}
	}
	if value := strings.TrimSpace(r.RemoteAddr); value != "" {
		return &value
	}
	return nil
}

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetType, targetID string, details map[string]any, ip *string) error {
	if s.DB == nil || userID == "" {
		return nil
	}
	payload := "{}"
	if details != nil {
		encoded, err := json.Marshal(details)
		if err != nil {
			return err
		}
		payload = string(encoded)
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7)
`, uuid.NewString(), userID, action, targetType, targetID, payload, ip)
	return err
}

func scanFirewallRules(rows pgxRows) ([]firewallRule, error) {
	items := make([]firewallRule, 0)
	for rows.Next() {
		var (
			item        firewallRule
			scope       sql.NullString
			description sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.TenantID,
			&item.Name,
			&item.Pattern,
			&item.Action,
			&scope,
			&description,
			&item.Enabled,
			&item.Priority,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan firewall rule: %w", err)
		}
		if scope.Valid {
			item.Scope = &scope.String
		}
		if description.Valid {
			item.Description = &description.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate firewall rules: %w", err)
	}
	return items, nil
}

func scanMaskingPolicies(rows pgxRows) ([]maskingPolicy, error) {
	items := make([]maskingPolicy, 0)
	for rows.Next() {
		var (
			item        maskingPolicy
			scope       sql.NullString
			description sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.TenantID,
			&item.Name,
			&item.ColumnPattern,
			&item.Strategy,
			&item.ExemptRoles,
			&scope,
			&description,
			&item.Enabled,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan masking policy: %w", err)
		}
		if scope.Valid {
			item.Scope = &scope.String
		}
		if description.Valid {
			item.Description = &description.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate masking policies: %w", err)
	}
	return items, nil
}

func scanRateLimitPolicies(rows pgxRows) ([]rateLimitPolicy, error) {
	items := make([]rateLimitPolicy, 0)
	for rows.Next() {
		var (
			item      rateLimitPolicy
			queryType sql.NullString
			scope     sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.TenantID,
			&item.Name,
			&queryType,
			&item.WindowMS,
			&item.MaxQueries,
			&item.BurstMax,
			&item.ExemptRoles,
			&scope,
			&item.Action,
			&item.Enabled,
			&item.Priority,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan rate limit policy: %w", err)
		}
		if queryType.Valid {
			item.QueryType = &queryType.String
		}
		if scope.Valid {
			item.Scope = &scope.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rate limit policies: %w", err)
	}
	return items, nil
}

type pgxRows interface {
	Next() bool
	Scan(...any) error
	Err() error
}
