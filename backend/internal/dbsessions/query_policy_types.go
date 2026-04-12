package dbsessions

import (
	"database/sql"
	"regexp"
	"sync"
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
	Name     string
	Pattern  string
	Action   string
	Scope    sql.NullString
	Priority int
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
	Priority    int
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
	// Buckets are process-local and keyed by user, tenant, query type, and policy.
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
