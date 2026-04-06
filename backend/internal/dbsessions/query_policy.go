package dbsessions

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"math"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/queryrunner"
	"github.com/google/uuid"
)

type dbQueryType string

const (
	dbQueryTypeSelect dbQueryType = "SELECT"
	dbQueryTypeInsert dbQueryType = "INSERT"
	dbQueryTypeUpdate dbQueryType = "UPDATE"
	dbQueryTypeDelete dbQueryType = "DELETE"
	dbQueryTypeDDL    dbQueryType = "DDL"
	dbQueryTypeOther  dbQueryType = "OTHER"
)

type firewallEvaluation struct {
	Allowed  bool
	Action   string
	RuleName string
	Matched  bool
}

type firewallRuleRecord struct {
	Name    string
	Pattern string
	Action  string
	Scope   sql.NullString
}

type maskingPolicyRecord struct {
	Name          string
	ColumnPattern string
	Strategy      string
	ExemptRoles   []string
	Scope         sql.NullString
}

type maskedColumn struct {
	ColumnName string
	Strategy   string
	PolicyName string
}

type rateLimitPolicyRecord struct {
	ID          string
	Name        string
	QueryType   sql.NullString
	WindowMS    int
	MaxQueries  int
	BurstMax    int
	ExemptRoles []string
	Scope       sql.NullString
	Action      string
}

type rateLimitEvaluation struct {
	Allowed      bool
	PolicyName   string
	Action       string
	Remaining    int
	RetryAfterMS int
	Matched      bool
}

type tokenBucket struct {
	Tokens         float64
	LastRefillUnix int64
	LastSeenUnix   int64
	WindowMS       int
	MaxTokens      int
	RefillRate     float64
}

var (
	dbRateLimitBuckets   = map[string]*tokenBucket{}
	dbRateLimitBucketsMu sync.Mutex
)

type builtinFirewallPattern struct {
	Name    string
	Pattern string
	Action  string
}

var builtinDBFirewallPatterns = []builtinFirewallPattern{
	{Name: "Drop Table", Pattern: `\bDROP\s+TABLE\b`, Action: "BLOCK"},
	{Name: "Truncate", Pattern: `\bTRUNCATE\b`, Action: "BLOCK"},
	{Name: "Drop Database", Pattern: `\bDROP\s+DATABASE\b`, Action: "BLOCK"},
	{Name: "Bulk SELECT without WHERE", Pattern: `^\s*SELECT\s+\*\s+FROM\s+\S+\s*;?\s*$`, Action: "ALERT"},
}

var reservedTableWords = map[string]struct{}{
	"select": {}, "set": {}, "values": {}, "where": {}, "group": {}, "order": {}, "having": {},
	"limit": {}, "offset": {}, "union": {}, "except": {}, "intersect": {}, "case": {}, "when": {},
	"then": {}, "else": {}, "end": {}, "as": {}, "on": {}, "and": {}, "or": {}, "not": {}, "in": {},
	"exists": {}, "between": {}, "like": {}, "is": {}, "null": {}, "true": {}, "false": {},
	"dual": {}, "information_schema": {},
}

type compiledRegexCacheEntry struct {
	re *regexp.Regexp
	ok bool
}

var (
	dbQueryTypeDDLPattern     = regexp.MustCompile(`(?i)^\s*(CREATE|ALTER|DROP|TRUNCATE|RENAME|COMMENT)\b`)
	dbQueryTypeSelectPattern  = regexp.MustCompile(`(?i)^\s*SELECT\b`)
	dbQueryTypeInsertPattern  = regexp.MustCompile(`(?i)^\s*INSERT\b`)
	dbQueryTypeUpdatePattern  = regexp.MustCompile(`(?i)^\s*UPDATE\b`)
	dbQueryTypeDeletePattern  = regexp.MustCompile(`(?i)^\s*DELETE\b`)
	dbQueryTypeWithPattern    = regexp.MustCompile(`(?i)^\s*WITH\b`)
	dbCteSelectPattern        = regexp.MustCompile(`(?i)\)\s*SELECT\b`)
	dbCteInsertPattern        = regexp.MustCompile(`(?i)\)\s*INSERT\b`)
	dbCteUpdatePattern        = regexp.MustCompile(`(?i)\)\s*UPDATE\b`)
	dbCteDeletePattern        = regexp.MustCompile(`(?i)\)\s*DELETE\b`)
	dbQueryTypeExplainPattern = regexp.MustCompile(`(?i)^\s*(EXPLAIN|DESCRIBE|DESC)\b`)
	dbQueryTypeShowPattern    = regexp.MustCompile(`(?i)^\s*SHOW\b`)
	dbQueryTypeSetPattern     = regexp.MustCompile(`(?i)^\s*SET\b`)
	dbQueryTypeGrantPattern   = regexp.MustCompile(`(?i)^\s*(GRANT|REVOKE)\b`)
	dbQueryTypeMergePattern   = regexp.MustCompile(`(?i)^\s*MERGE\b`)
	dbQueryTypeCallPattern    = regexp.MustCompile(`(?i)^\s*(CALL|EXEC|EXECUTE)\b`)

	dbTableAccessPatterns = []*regexp.Regexp{
		regexp.MustCompile("(?i)\\bFROM\\s+([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
		regexp.MustCompile("(?i)\\bJOIN\\s+([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
		regexp.MustCompile("(?i)\\bINTO\\s+([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
		regexp.MustCompile("(?i)\\bUPDATE\\s+([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
		regexp.MustCompile("(?i)\\bTABLE\\s+(?:IF\\s+(?:NOT\\s+)?EXISTS\\s+)?([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
		regexp.MustCompile("(?i)\\bTRUNCATE\\s+(?:TABLE\\s+)?([\"\\x60]?[\\w]+[\"\\x60]?(?:\\s*\\.\\s*[\"\\x60]?[\\w]+[\"\\x60]?)?)"),
	}

	compiledPatternCache sync.Map
)

func compileCaseInsensitiveRegex(pattern string) (*regexp.Regexp, bool) {
	cacheKey := "(?i)" + pattern
	if value, ok := compiledPatternCache.Load(cacheKey); ok {
		entry := value.(compiledRegexCacheEntry)
		return entry.re, entry.ok
	}

	re, err := regexp.Compile(cacheKey)
	entry := compiledRegexCacheEntry{re: re, ok: err == nil}
	actual, _ := compiledPatternCache.LoadOrStore(cacheKey, entry)
	cached := actual.(compiledRegexCacheEntry)
	return cached.re, cached.ok
}

func classifyDBQuery(queryText string) dbQueryType {
	if operation, ok := parseMongoOperation(queryText); ok {
		switch operation {
		case "find", "aggregate", "count", "distinct", "runcmd", "runcommand":
			return dbQueryTypeSelect
		case "insertone", "insertmany":
			return dbQueryTypeInsert
		case "updateone", "updatemany":
			return dbQueryTypeUpdate
		case "deleteone", "deletemany":
			return dbQueryTypeDelete
		default:
			return dbQueryTypeOther
		}
	}

	trimmed := stripLeadingSQLComments(queryText)

	switch {
	case dbQueryTypeDDLPattern.MatchString(trimmed):
		return dbQueryTypeDDL
	case dbQueryTypeSelectPattern.MatchString(trimmed):
		return dbQueryTypeSelect
	case dbQueryTypeInsertPattern.MatchString(trimmed):
		return dbQueryTypeInsert
	case dbQueryTypeUpdatePattern.MatchString(trimmed):
		return dbQueryTypeUpdate
	case dbQueryTypeDeletePattern.MatchString(trimmed):
		return dbQueryTypeDelete
	case dbQueryTypeWithPattern.MatchString(trimmed):
		switch {
		case dbCteSelectPattern.MatchString(trimmed):
			return dbQueryTypeSelect
		case dbCteInsertPattern.MatchString(trimmed):
			return dbQueryTypeInsert
		case dbCteUpdatePattern.MatchString(trimmed):
			return dbQueryTypeUpdate
		case dbCteDeletePattern.MatchString(trimmed):
			return dbQueryTypeDelete
		default:
			return dbQueryTypeSelect
		}
	case dbQueryTypeExplainPattern.MatchString(trimmed):
		return dbQueryTypeSelect
	case dbQueryTypeShowPattern.MatchString(trimmed):
		return dbQueryTypeSelect
	case dbQueryTypeSetPattern.MatchString(trimmed):
		return dbQueryTypeDDL
	case dbQueryTypeGrantPattern.MatchString(trimmed):
		return dbQueryTypeDDL
	case dbQueryTypeMergePattern.MatchString(trimmed):
		return dbQueryTypeUpdate
	case dbQueryTypeCallPattern.MatchString(trimmed):
		return dbQueryTypeOther
	default:
		return dbQueryTypeOther
	}
}

func stripLeadingSQLComments(sqlText string) string {
	i := 0
	for i < len(sqlText) {
		switch sqlText[i] {
		case ' ', '\t', '\n', '\r':
			i++
			continue
		}
		if i+1 < len(sqlText) && sqlText[i] == '-' && sqlText[i+1] == '-' {
			i += 2
			for i < len(sqlText) && sqlText[i] != '\n' {
				i++
			}
			if i < len(sqlText) {
				i++
			}
			continue
		}
		if i+1 < len(sqlText) && sqlText[i] == '/' && sqlText[i+1] == '*' {
			i += 2
			for i+1 < len(sqlText) && !(sqlText[i] == '*' && sqlText[i+1] == '/') {
				i++
			}
			if i+1 < len(sqlText) {
				i += 2
			}
			continue
		}
		break
	}
	return sqlText[i:]
}

func extractTablesAccessed(queryText string) []string {
	if collection, ok := parseMongoCollection(queryText); ok {
		return []string{collection}
	}

	seen := map[string]struct{}{}
	items := make([]string, 0)
	for _, pattern := range dbTableAccessPatterns {
		matches := pattern.FindAllStringSubmatch(queryText, -1)
		for _, match := range matches {
			if len(match) < 2 {
				continue
			}
			name := strings.ToLower(strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(match[1], `"`, ""), "`", "")))
			if name == "" {
				continue
			}
			if _, reserved := reservedTableWords[name]; reserved {
				continue
			}
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			items = append(items, name)
		}
	}
	return items
}

func parseMongoOperation(queryText string) (string, bool) {
	operation, _, err := queryrunner.ParseMongoQueryMetadata(queryText)
	if err != nil {
		return "", false
	}
	if operation == "" {
		return "", false
	}
	return operation, true
}

func parseMongoCollection(queryText string) (string, bool) {
	_, collection, err := queryrunner.ParseMongoQueryMetadata(queryText)
	if err != nil {
		return "", false
	}
	collection = strings.ToLower(strings.TrimSpace(collection))
	if collection == "" {
		return "", false
	}
	return collection, true
}

func (s Service) evaluateFirewall(ctx context.Context, tenantID, queryText, database, table string) firewallEvaluation {
	if s.DB == nil || strings.TrimSpace(tenantID) == "" {
		return firewallEvaluation{Allowed: true}
	}

	rows, err := s.DB.Query(ctx, `
SELECT name, pattern, action::text, scope
FROM "DbFirewallRule"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err == nil {
		defer rows.Close()

		for rows.Next() {
			var rule firewallRuleRecord
			if scanErr := rows.Scan(&rule.Name, &rule.Pattern, &rule.Action, &rule.Scope); scanErr != nil {
				break
			}
			if matchesScopedRegex(rule.Pattern, rule.Scope.String, queryText, database, table) {
				action := strings.ToUpper(strings.TrimSpace(rule.Action))
				return firewallEvaluation{
					Allowed:  action != "BLOCK",
					Action:   action,
					RuleName: rule.Name,
					Matched:  true,
				}
			}
		}
	}

	for _, builtin := range builtinDBFirewallPatterns {
		re, ok := compileCaseInsensitiveRegex(builtin.Pattern)
		if !ok {
			continue
		}
		if re.MatchString(queryText) {
			return firewallEvaluation{
				Allowed:  builtin.Action != "BLOCK",
				Action:   builtin.Action,
				RuleName: "[Built-in] " + builtin.Name,
				Matched:  true,
			}
		}
	}

	return firewallEvaluation{Allowed: true}
}

func matchesScopedRegex(pattern, scope, queryText, database, table string) bool {
	if trimmed := strings.ToLower(strings.TrimSpace(scope)); trimmed != "" {
		database = strings.ToLower(strings.TrimSpace(database))
		table = strings.ToLower(strings.TrimSpace(table))
		if database != trimmed && table != trimmed {
			return false
		}
	}

	re, ok := compileCaseInsensitiveRegex(pattern)
	if !ok {
		return false
	}
	return re.MatchString(queryText)
}

func (s Service) loadMaskingPolicies(ctx context.Context, tenantID string) []maskingPolicyRecord {
	if s.DB == nil || strings.TrimSpace(tenantID) == "" {
		return nil
	}

	rows, err := s.DB.Query(ctx, `
SELECT name, "columnPattern", strategy::text, "exemptRoles", scope
FROM "DbMaskingPolicy"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY "createdAt" ASC
`, tenantID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	items := make([]maskingPolicyRecord, 0)
	for rows.Next() {
		var item maskingPolicyRecord
		if scanErr := rows.Scan(&item.Name, &item.ColumnPattern, &item.Strategy, &item.ExemptRoles, &item.Scope); scanErr != nil {
			return nil
		}
		items = append(items, item)
	}
	return items
}

func findMaskedColumns(policies []maskingPolicyRecord, columns []string, userRole, database, table string) []maskedColumn {
	if len(policies) == 0 || len(columns) == 0 {
		return nil
	}

	userRole = strings.ToUpper(strings.TrimSpace(userRole))
	database = strings.ToLower(strings.TrimSpace(database))
	table = strings.ToLower(strings.TrimSpace(table))

	items := make([]maskedColumn, 0)
	for _, column := range columns {
		for _, policy := range policies {
			scope := strings.ToLower(strings.TrimSpace(policy.Scope.String))
			if scope != "" && scope != database && scope != table {
				continue
			}
			if roleExempt(policy.ExemptRoles, userRole) {
				continue
			}
			re, ok := compileCaseInsensitiveRegex(policy.ColumnPattern)
			if !ok {
				continue
			}
			if re.MatchString(column) {
				items = append(items, maskedColumn{
					ColumnName: column,
					Strategy:   strings.ToUpper(strings.TrimSpace(policy.Strategy)),
					PolicyName: policy.Name,
				})
				break
			}
		}
	}
	return items
}

func roleExempt(exemptRoles []string, userRole string) bool {
	if userRole == "" {
		return false
	}
	for _, exemptRole := range exemptRoles {
		if strings.EqualFold(strings.TrimSpace(exemptRole), userRole) {
			return true
		}
	}
	return false
}

func applyMasking(rows []map[string]any, masked []maskedColumn) []map[string]any {
	if len(rows) == 0 || len(masked) == 0 {
		return rows
	}

	strategies := make(map[string]string, len(masked))
	for _, item := range masked {
		strategies[item.ColumnName] = item.Strategy
	}

	result := make([]map[string]any, 0, len(rows))
	for _, row := range rows {
		next := make(map[string]any, len(row))
		for key, value := range row {
			strategy, ok := strategies[key]
			if !ok {
				next[key] = value
				continue
			}
			next[key] = maskValue(value, strategy)
		}
		result = append(result, next)
	}
	return result
}

func maskValue(value any, strategy string) string {
	if value == nil {
		return "***"
	}
	raw := valueToString(value)
	switch strings.ToUpper(strings.TrimSpace(strategy)) {
	case "HASH":
		sum := sha256.Sum256([]byte(raw))
		return hex.EncodeToString(sum[:])[:16]
	case "PARTIAL":
		if len(raw) <= 4 {
			return "****"
		}
		visible := int(math.Min(4, math.Floor(float64(len(raw))*0.25)))
		if visible < 1 {
			visible = 1
		}
		return raw[:visible] + strings.Repeat("*", len(raw)-visible)
	default:
		return "***REDACTED***"
	}
}

func valueToString(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []byte:
		return string(typed)
	default:
		payload, err := json.Marshal(typed)
		if err != nil {
			return ""
		}
		return string(payload)
	}
}

func (s Service) evaluateRateLimit(ctx context.Context, userID, tenantID string, queryType dbQueryType, tenantRole, database, table string) rateLimitEvaluation {
	if s.DB == nil || strings.TrimSpace(tenantID) == "" || strings.TrimSpace(userID) == "" {
		return rateLimitEvaluation{Allowed: true, Remaining: -1}
	}

	rows, err := s.DB.Query(ctx, `
SELECT id, name, "queryType"::text, "windowMs", "maxQueries", "burstMax", "exemptRoles", scope, action::text
FROM "DbRateLimitPolicy"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return rateLimitEvaluation{Allowed: true, Remaining: -1}
	}
	defer rows.Close()

	database = strings.ToLower(strings.TrimSpace(database))
	table = strings.ToLower(strings.TrimSpace(table))
	tenantRole = strings.ToUpper(strings.TrimSpace(tenantRole))

	now := time.Now()

	for rows.Next() {
		var policy rateLimitPolicyRecord
		if scanErr := rows.Scan(&policy.ID, &policy.Name, &policy.QueryType, &policy.WindowMS, &policy.MaxQueries, &policy.BurstMax, &policy.ExemptRoles, &policy.Scope, &policy.Action); scanErr != nil {
			return rateLimitEvaluation{Allowed: true, Remaining: -1}
		}
		if policy.QueryType.Valid && !strings.EqualFold(policy.QueryType.String, string(queryType)) {
			continue
		}
		scope := strings.ToLower(strings.TrimSpace(policy.Scope.String))
		if scope != "" && scope != database && scope != table {
			continue
		}
		if roleExempt(policy.ExemptRoles, tenantRole) {
			continue
		}

		keyType := "ALL"
		if policy.QueryType.Valid && strings.TrimSpace(policy.QueryType.String) != "" {
			keyType = strings.ToUpper(strings.TrimSpace(policy.QueryType.String))
		}
		bucketKey := strings.Join([]string{
			strings.TrimSpace(userID),
			strings.TrimSpace(tenantID),
			keyType,
			strings.TrimSpace(policy.ID),
		}, ":")

		dbRateLimitBucketsMu.Lock()
		cleanupExpiredBucketsLocked(now)
		bucket := getOrCreateBucketLocked(bucketKey, policy, now)
		if bucket.Tokens >= 1 {
			bucket.Tokens -= 1
			remaining := int(math.Max(0, math.Floor(bucket.Tokens)))
			dbRateLimitBucketsMu.Unlock()
			return rateLimitEvaluation{
				Allowed:    true,
				PolicyName: policy.Name,
				Action:     strings.ToUpper(strings.TrimSpace(policy.Action)),
				Remaining:  remaining,
				Matched:    true,
			}
		}

		retryAfterMS := 0
		if bucket.RefillRate > 0 {
			retryAfterMS = int(math.Ceil((1 - bucket.Tokens) / bucket.RefillRate))
		}
		remaining := int(math.Max(0, math.Floor(bucket.Tokens)))
		dbRateLimitBucketsMu.Unlock()

		action := strings.ToUpper(strings.TrimSpace(policy.Action))
		return rateLimitEvaluation{
			Allowed:      action == "LOG_ONLY",
			PolicyName:   policy.Name,
			Action:       action,
			Remaining:    remaining,
			RetryAfterMS: retryAfterMS,
			Matched:      true,
		}
	}

	return rateLimitEvaluation{Allowed: true, Remaining: -1}
}

func cleanupExpiredBucketsLocked(now time.Time) {
	nowUnix := now.UnixMilli()
	for key, bucket := range dbRateLimitBuckets {
		if nowUnix-bucket.LastSeenUnix > int64(bucket.WindowMS*2) {
			delete(dbRateLimitBuckets, key)
		}
	}
}

func getOrCreateBucketLocked(key string, policy rateLimitPolicyRecord, now time.Time) *tokenBucket {
	nowUnix := now.UnixMilli()
	if bucket, ok := dbRateLimitBuckets[key]; ok {
		elapsed := float64(nowUnix-bucket.LastRefillUnix) * bucket.RefillRate
		bucket.Tokens = math.Min(float64(bucket.MaxTokens), bucket.Tokens+elapsed)
		bucket.LastRefillUnix = nowUnix
		bucket.LastSeenUnix = nowUnix
		bucket.WindowMS = policy.WindowMS
		bucket.MaxTokens = policy.BurstMax
		bucket.RefillRate = float64(policy.MaxQueries) / float64(policy.WindowMS)
		if bucket.Tokens > float64(bucket.MaxTokens) {
			bucket.Tokens = float64(bucket.MaxTokens)
		}
		return bucket
	}

	bucket := &tokenBucket{
		Tokens:         float64(policy.BurstMax),
		LastRefillUnix: nowUnix,
		LastSeenUnix:   nowUnix,
		WindowMS:       policy.WindowMS,
		MaxTokens:      policy.BurstMax,
		RefillRate:     float64(policy.MaxQueries) / float64(policy.WindowMS),
	}
	dbRateLimitBuckets[key] = bucket
	return bucket
}

func (s Service) interceptQuery(ctx context.Context, userID, connectionID, tenantID, sessionID, queryText string, rowsAffected, executionTimeMS *int, blocked bool, blockReason string, executionPlan any) {
	if s.DB == nil || strings.TrimSpace(userID) == "" || strings.TrimSpace(connectionID) == "" || strings.TrimSpace(queryText) == "" {
		return
	}

	tables := extractTablesAccessed(queryText)
	queryType := classifyDBQuery(queryText)
	planJSON := "null"
	if executionPlan != nil {
		if raw, err := json.Marshal(executionPlan); err == nil {
			planJSON = string(raw)
		}
	}

	_, _ = s.DB.Exec(ctx, `
INSERT INTO "DbAuditLog" (
	id, "userId", "connectionId", "tenantId", "sessionId", "queryText", "queryType", "tablesAccessed",
	"rowsAffected", "executionTimeMs", blocked, "blockReason", "executionPlan", "createdAt"
) VALUES (
	$1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), $6, $7::"DbQueryType", $8::text[],
	$9, $10, $11, NULLIF($12, ''), $13::jsonb, NOW()
)`,
		uuid.NewString(),
		strings.TrimSpace(userID),
		strings.TrimSpace(connectionID),
		strings.TrimSpace(tenantID),
		strings.TrimSpace(sessionID),
		queryText,
		string(queryType),
		tables,
		rowsAffected,
		executionTimeMS,
		blocked,
		strings.TrimSpace(blockReason),
		planJSON,
	)
}

func (s Service) insertQueryAuditEvent(ctx context.Context, userID, action, targetID string, details map[string]any, ipAddress string) {
	if s.DB == nil || strings.TrimSpace(action) == "" {
		return
	}

	payload, err := json.Marshal(details)
	if err != nil {
		return
	}

	_, _ = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, NULLIF($2, ''), $3::"AuditAction", 'DatabaseQuery', NULLIF($4, ''), $5::jsonb, NULLIF($6, ''))
`,
		uuid.NewString(),
		strings.TrimSpace(userID),
		strings.TrimSpace(action),
		strings.TrimSpace(targetID),
		string(payload),
		strings.TrimSpace(ipAddress),
	)
}
