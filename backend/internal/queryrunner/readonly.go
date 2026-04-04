package queryrunner

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"reflect"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultMaxRows      = 100
	maxAllowedRows      = 1000
	defaultQueryTimeout = 10 * time.Second
)

var forbiddenTokens = regexp.MustCompile(`\b(insert|update|delete|alter|drop|create|grant|revoke|truncate|copy|call|do|refresh|vacuum|analyze|cluster|reindex|lock|begin|commit|rollback|savepoint|set\s+transaction)\b`)

type poolLike interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

func ValidateReadOnlySQL(sql string) error {
	trimmed := strings.TrimSpace(sql)
	if trimmed == "" {
		return fmt.Errorf("sql is required")
	}

	normalized := normalizeSQL(trimmed)
	firstToken := firstKeyword(normalized)
	switch firstToken {
	case "select", "with", "show", "explain":
	default:
		return fmt.Errorf("only SELECT, WITH, SHOW, and EXPLAIN statements are allowed")
	}

	if forbiddenTokens.MatchString(normalized) {
		return fmt.Errorf("query contains non-read-only tokens")
	}

	if hasMultipleStatements(trimmed) {
		return fmt.Errorf("multiple SQL statements are not allowed")
	}

	return nil
}

func ExecuteReadOnly(ctx context.Context, pool poolLike, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	switch targetProtocol(req.Target) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		return executeSQLReadOnly(ctx, req.Target, req)
	case protocolMongoDB:
		return executeMongoReadOnly(ctx, req.Target, req)
	}

	if err := ValidateReadOnlySQL(req.SQL); err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	maxRows := req.MaxRows
	switch {
	case maxRows <= 0:
		maxRows = defaultMaxRows
	case maxRows > maxAllowedRows:
		maxRows = maxAllowedRows
	}

	queryPool, cleanup, err := resolvePool(ctx, pool, req)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	defer cleanup()

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	start := time.Now()
	rows, err := queryPool.Query(queryCtx, req.SQL)
	if err != nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("execute query: %w", err)
	}
	defer rows.Close()

	fieldDescriptions := rows.FieldDescriptions()
	columns := make([]string, len(fieldDescriptions))
	for i, field := range fieldDescriptions {
		columns[i] = string(field.Name)
	}

	result := contracts.QueryExecutionResponse{
		Columns: columns,
		Rows:    make([]map[string]any, 0, min(maxRows, 16)),
	}

	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("scan row values: %w", err)
		}

		result.RowCount++
		if len(result.Rows) < maxRows {
			row := make(map[string]any, len(columns))
			for idx, column := range columns {
				row[column] = normalizeValue(values[idx])
			}
			result.Rows = append(result.Rows, row)
		} else {
			result.Truncated = true
			break
		}
	}

	if err := rows.Err(); err != nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("iterate rows: %w", err)
	}

	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func resolvePool(
	ctx context.Context,
	defaultPool poolLike,
	req contracts.QueryExecutionRequest,
) (poolLike, func(), error) {
	if req.Target == nil {
		if isNilPool(defaultPool) {
			return nil, nil, fmt.Errorf("postgres pool is not configured")
		}
		return defaultPool, func() {}, nil
	}

	target := req.Target
	protocol := strings.ToLower(strings.TrimSpace(target.Protocol))
	if protocol == "" {
		protocol = "postgresql"
	}
	if protocol != "postgresql" {
		return nil, nil, fmt.Errorf("unsupported database protocol %q", target.Protocol)
	}
	if strings.TrimSpace(target.Host) == "" {
		return nil, nil, fmt.Errorf("target.host is required")
	}
	if target.Port <= 0 || target.Port > 65535 {
		return nil, nil, fmt.Errorf("target.port must be between 1 and 65535")
	}
	if strings.TrimSpace(target.Username) == "" {
		return nil, nil, fmt.Errorf("target.username is required")
	}

	database := strings.TrimSpace(target.Database)
	if database == "" && target.SessionConfig != nil {
		database = strings.TrimSpace(target.SessionConfig.ActiveDatabase)
	}
	if database == "" {
		database = "postgres"
	}

	u := &url.URL{
		Scheme: "postgresql",
		User:   url.UserPassword(target.Username, target.Password),
		Host:   net.JoinHostPort(target.Host, strconv.Itoa(target.Port)),
		Path:   database,
	}
	query := u.Query()
	query.Set("application_name", "arsenale-query-runner")
	query.Set("pool_max_conns", "3")
	query.Set("pool_min_conns", "0")
	query.Set("connect_timeout", "10")
	if sslMode := normalizePostgresSSLMode(target.SSLMode); sslMode != "" {
		query.Set("sslmode", sslMode)
	}
	u.RawQuery = query.Encode()

	cfg, err := pgxpool.ParseConfig(u.String())
	if err != nil {
		return nil, nil, fmt.Errorf("parse target postgres config: %w", err)
	}

	if initStatements := buildSessionInitStatements(protocolPostgreSQL, target.SessionConfig); len(initStatements) > 0 {
		cfg.AfterConnect = func(ctx context.Context, conn *pgx.Conn) error {
			for _, statement := range initStatements {
				if _, err := conn.Exec(ctx, statement); err != nil {
					return fmt.Errorf("apply session config statement %q: %w", statement, err)
				}
			}
			return nil
		}
	}

	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, nil, fmt.Errorf("connect to target postgres: %w", err)
	}
	return pool, pool.Close, nil
}

func isNilPool(pool poolLike) bool {
	if pool == nil {
		return true
	}
	value := reflect.ValueOf(pool)
	switch value.Kind() {
	case reflect.Chan, reflect.Func, reflect.Interface, reflect.Map, reflect.Pointer, reflect.Slice:
		return value.IsNil()
	default:
		return false
	}
}

func normalizeSQL(sql string) string {
	withoutBlockComments := regexp.MustCompile(`(?s)/\*.*?\*/`).ReplaceAllString(sql, " ")
	lines := strings.Split(withoutBlockComments, "\n")
	for i, line := range lines {
		if idx := strings.Index(line, "--"); idx >= 0 {
			line = line[:idx]
		}
		lines[i] = line
	}
	return strings.ToLower(strings.Join(lines, " "))
}

func firstKeyword(sql string) string {
	fields := strings.Fields(sql)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func hasMultipleStatements(sql string) bool {
	trimmed := strings.TrimSpace(sql)
	if trimmed == "" {
		return false
	}
	trimmed = strings.TrimSuffix(trimmed, ";")
	return strings.Contains(trimmed, ";")
}

func normalizeValue(value any) any {
	switch typed := value.(type) {
	case []byte:
		return string(typed)
	default:
		return value
	}
}
