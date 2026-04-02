package queryrunner

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net"
	"net/url"
	"strconv"
	"strings"
	"time"

	mysqlDriver "github.com/go-sql-driver/mysql"
	_ "github.com/jackc/pgx/v5/stdlib"
	_ "github.com/microsoft/go-mssqldb"
	go_ora "github.com/sijms/go-ora/v2"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type sqlTargetConn struct {
	db       *sql.DB
	conn     *sql.Conn
	protocol string
}

type objectRef struct {
	Schema string
	Name   string
	Column string
}

func openSQLTargetConn(ctx context.Context, target *contracts.DatabaseTarget) (*sqlTargetConn, error) {
	protocol := targetProtocol(target)
	if !isSQLProtocol(protocol) {
		return nil, fmt.Errorf("unsupported database protocol %q", target.Protocol)
	}

	driverName, dsn, err := sqlTargetDSN(target)
	if err != nil {
		return nil, err
	}

	db, err := sql.Open(driverName, dsn)
	if err != nil {
		return nil, fmt.Errorf("open %s connection: %w", protocol, err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(0)
	db.SetConnMaxLifetime(30 * time.Second)

	pingCtx, pingCancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer pingCancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping %s: %w", protocol, err)
	}

	conn, err := db.Conn(ctx)
	if err != nil {
		db.Close()
		return nil, fmt.Errorf("open %s dedicated connection: %w", protocol, err)
	}

	if err := applySQLSessionConfig(ctx, conn, target, protocol); err != nil {
		conn.Close()
		db.Close()
		return nil, err
	}

	return &sqlTargetConn{
		db:       db,
		conn:     conn,
		protocol: protocol,
	}, nil
}

func (c *sqlTargetConn) Close() {
	if c == nil {
		return
	}
	if c.conn != nil {
		_ = c.conn.Close()
	}
	if c.db != nil {
		_ = c.db.Close()
	}
}

func sqlTargetDSN(target *contracts.DatabaseTarget) (string, string, error) {
	if target == nil {
		return "", "", fmt.Errorf("target is required")
	}

	protocol := targetProtocol(target)
	switch protocol {
	case protocolPostgreSQL:
		dsn, err := buildPostgresDSN(target)
		return "pgx", dsn, err
	case protocolMySQL:
		dsn, err := buildMySQLDSN(target)
		return "mysql", dsn, err
	case protocolMSSQL:
		dsn, err := buildMSSQLDSN(target)
		return "sqlserver", dsn, err
	case protocolOracle:
		dsn, err := buildOracleDSN(target)
		return "oracle", dsn, err
	default:
		return "", "", fmt.Errorf("unsupported database protocol %q", target.Protocol)
	}
}

func buildPostgresDSN(target *contracts.DatabaseTarget) (string, error) {
	if err := validateNetworkTarget(target); err != nil {
		return "", err
	}

	database := effectiveTargetDatabase(target)
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
	query.Set("connect_timeout", "10")
	if sslMode := strings.TrimSpace(target.SSLMode); sslMode != "" {
		query.Set("sslmode", sslMode)
	}
	u.RawQuery = query.Encode()
	return u.String(), nil
}

func buildMySQLDSN(target *contracts.DatabaseTarget) (string, error) {
	if err := validateNetworkTarget(target); err != nil {
		return "", err
	}

	cfg := mysqlDriver.NewConfig()
	cfg.User = target.Username
	cfg.Passwd = target.Password
	cfg.Net = "tcp"
	cfg.Addr = net.JoinHostPort(target.Host, strconv.Itoa(target.Port))
	cfg.DBName = effectiveTargetDatabase(target)
	cfg.ParseTime = true
	cfg.Timeout = 10 * time.Second
	cfg.ReadTimeout = defaultQueryTimeout
	cfg.WriteTimeout = defaultQueryTimeout
	cfg.Params = map[string]string{
		"charset": "utf8mb4",
	}

	switch strings.ToLower(strings.TrimSpace(target.SSLMode)) {
	case "", "disable", "disabled", "false", "off":
		cfg.TLSConfig = "false"
	default:
		cfg.TLSConfig = "preferred"
	}

	return cfg.FormatDSN(), nil
}

func buildMSSQLDSN(target *contracts.DatabaseTarget) (string, error) {
	if err := validateNetworkTarget(target); err != nil {
		return "", err
	}

	u := &url.URL{
		Scheme: "sqlserver",
		User:   url.UserPassword(target.Username, target.Password),
		Host:   net.JoinHostPort(target.Host, strconv.Itoa(target.Port)),
	}
	query := u.Query()
	if database := effectiveTargetDatabase(target); database != "" {
		query.Set("database", database)
	}
	if instance := strings.TrimSpace(target.MSSQLInstanceName); instance != "" {
		query.Set("instance", instance)
	}
	query.Set("app name", "arsenale-query-runner")
	query.Set("connection timeout", "10")

	switch strings.ToLower(strings.TrimSpace(target.SSLMode)) {
	case "", "disable", "disabled", "false", "off":
		query.Set("encrypt", "disable")
	case "require", "required", "true", "on":
		query.Set("encrypt", "true")
		query.Set("TrustServerCertificate", "true")
	default:
		query.Set("encrypt", "true")
		query.Set("TrustServerCertificate", "true")
	}

	u.RawQuery = query.Encode()
	return u.String(), nil
}

func buildOracleDSN(target *contracts.DatabaseTarget) (string, error) {
	connectionType := strings.ToLower(strings.TrimSpace(target.OracleConnectionType))
	switch connectionType {
	case "custom":
		if strings.TrimSpace(target.OracleConnectString) == "" {
			return "", fmt.Errorf("oracle custom connection string is required")
		}
		return go_ora.BuildJDBC(target.Username, target.Password, target.OracleConnectString, nil), nil
	case "tns":
		if descriptor := strings.TrimSpace(target.OracleTNSDescriptor); descriptor != "" {
			return go_ora.BuildJDBC(target.Username, target.Password, descriptor, nil), nil
		}
		if alias := strings.TrimSpace(target.OracleTNSAlias); alias != "" {
			return go_ora.BuildJDBC(target.Username, target.Password, alias, nil), nil
		}
		return "", fmt.Errorf("oracle tns alias or descriptor is required")
	default:
		if err := validateNetworkTarget(target); err != nil {
			return "", err
		}
		service := strings.TrimSpace(target.OracleServiceName)
		if service == "" {
			service = effectiveTargetDatabase(target)
		}
		options := map[string]string{}
		if sid := strings.TrimSpace(target.OracleSID); sid != "" {
			options["SID"] = sid
		}
		if role := strings.TrimSpace(target.OracleRole); role != "" && !strings.EqualFold(role, "normal") {
			options["DBA PRIVILEGE"] = strings.ToUpper(role)
		}
		if strings.TrimSpace(target.SSLMode) != "" && !strings.EqualFold(target.SSLMode, "disable") {
			options["AUTH TYPE"] = "TCPS"
		}
		return go_ora.BuildUrl(target.Host, target.Port, service, target.Username, target.Password, options), nil
	}
}

func validateNetworkTarget(target *contracts.DatabaseTarget) error {
	if target == nil {
		return fmt.Errorf("target is required")
	}
	if strings.TrimSpace(target.Host) == "" {
		return fmt.Errorf("target.host is required")
	}
	if target.Port <= 0 || target.Port > 65535 {
		return fmt.Errorf("target.port must be between 1 and 65535")
	}
	if strings.TrimSpace(target.Username) == "" {
		return fmt.Errorf("target.username is required")
	}
	return nil
}

func effectiveTargetDatabase(target *contracts.DatabaseTarget) string {
	if target == nil {
		return ""
	}
	if target.SessionConfig != nil && strings.TrimSpace(target.SessionConfig.ActiveDatabase) != "" {
		return strings.TrimSpace(target.SessionConfig.ActiveDatabase)
	}
	return strings.TrimSpace(target.Database)
}

func applySQLSessionConfig(ctx context.Context, conn *sql.Conn, target *contracts.DatabaseTarget, protocol string) error {
	if conn == nil {
		return fmt.Errorf("database connection is unavailable")
	}

	statements := buildTargetSessionInitStatements(target)
	if len(statements) == 0 {
		return nil
	}

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	for _, statement := range statements {
		if _, err := conn.ExecContext(queryCtx, statement); err != nil {
			return fmt.Errorf("apply session config statement %q: %w", statement, err)
		}
	}
	return nil
}

func executeSQLReadOnly(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	if err := ValidateReadOnlySQL(req.SQL); err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	return executeSQLAny(ctx, target, req)
}

func executeSQLAny(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	maxRows := req.MaxRows
	switch {
	case maxRows <= 0:
		maxRows = defaultMaxRows
	case maxRows > maxAllowedRows:
		maxRows = maxAllowedRows
	}

	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	defer sqlConn.Close()

	statements := splitStatements(req.SQL)
	if len(statements) == 0 {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("sql is required")
	}

	start := time.Now()
	var result contracts.QueryExecutionResponse
	for _, stmt := range statements {
		queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
		result, err = executeSingleSQLStatement(queryCtx, sqlConn.conn, stmt, maxRows)
		cancel()
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
	}
	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func executeSingleSQLStatement(ctx context.Context, conn *sql.Conn, stmt string, maxRows int) (contracts.QueryExecutionResponse, error) {
	if statementReturnsRows(stmt) {
		rows, err := conn.QueryContext(ctx, stmt)
		if err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("execute query: %w", err)
		}
		defer rows.Close()

		result, err := scanSQLRows(rows, maxRows)
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
		return result, nil
	}

	execResult, err := conn.ExecContext(ctx, stmt)
	if err != nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("execute query: %w", err)
	}

	rowsAffected, _ := execResult.RowsAffected()
	return contracts.QueryExecutionResponse{
		Columns:  []string{},
		Rows:     []map[string]any{},
		RowCount: int(rowsAffected),
	}, nil
}

func scanSQLRows(rows *sql.Rows, maxRows int) (contracts.QueryExecutionResponse, error) {
	columns, err := rows.Columns()
	if err != nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("read columns: %w", err)
	}

	result := contracts.QueryExecutionResponse{
		Columns: columns,
		Rows:    make([]map[string]any, 0, min(maxRows, 16)),
	}

	for rows.Next() {
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range values {
			dest[i] = &values[i]
		}

		if err := rows.Scan(dest...); err != nil {
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

	return result, nil
}

func statementReturnsRows(stmt string) bool {
	switch firstKeyword(normalizeSQL(stmt)) {
	case "select", "with", "show", "describe", "desc", "explain", "call", "exec", "execute":
		return true
	default:
		return false
	}
}

func fetchSQLSchema(ctx context.Context, target *contracts.DatabaseTarget) (contracts.SchemaInfo, error) {
	switch targetProtocol(target) {
	case protocolMySQL:
		return fetchMySQLSchema(ctx, target)
	case protocolMSSQL:
		return fetchMSSQLSchema(ctx, target)
	case protocolOracle:
		return fetchOracleSchema(ctx, target)
	default:
		return contracts.SchemaInfo{}, fmt.Errorf("unsupported database protocol %q", target.Protocol)
	}
}

func fetchMySQLSchema(ctx context.Context, target *contracts.DatabaseTarget) (contracts.SchemaInfo, error) {
	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	defer sqlConn.Close()

	result := emptySchemaInfo()
	tables, err := loadTableRefs(ctx, sqlConn.conn, `
SELECT table_schema, table_name
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
ORDER BY table_schema, table_name
`)
	if err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch tables: %w", err)
	}
	for _, table := range tables {
		item, err := loadMySQLTable(ctx, sqlConn.conn, table)
		if err != nil {
			return contracts.SchemaInfo{}, err
		}
		result.Tables = append(result.Tables, item)
	}
	if err := loadSchemaViews(ctx, sqlConn.conn, &result, `
SELECT table_schema, table_name, false
FROM information_schema.views
WHERE table_schema = DATABASE()
ORDER BY table_schema, table_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch views: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT routine_schema, routine_name, COALESCE(data_type, '')
FROM information_schema.routines
WHERE routine_schema = DATABASE() AND routine_type = 'FUNCTION'
ORDER BY routine_schema, routine_name
`, &result.Functions); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch functions: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT routine_schema, routine_name, ''
FROM information_schema.routines
WHERE routine_schema = DATABASE() AND routine_type = 'PROCEDURE'
ORDER BY routine_schema, routine_name
`, &result.Procedures); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch procedures: %w", err)
	}
	if err := loadSchemaTriggers(ctx, sqlConn.conn, &result, `
SELECT trigger_schema, trigger_name, event_object_table, action_timing, event_manipulation
FROM information_schema.triggers
WHERE trigger_schema = DATABASE()
ORDER BY trigger_schema, trigger_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch triggers: %w", err)
	}
	return result, nil
}

func loadMySQLTable(ctx context.Context, conn *sql.Conn, table objectRef) (contracts.SchemaTable, error) {
	rows, err := conn.QueryContext(ctx, `
SELECT column_name, column_type, is_nullable = 'YES', column_key = 'PRI'
FROM information_schema.columns
WHERE table_schema = ? AND table_name = ?
ORDER BY ordinal_position
`, table.Schema, table.Name)
	if err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("fetch columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	defer rows.Close()

	item := contracts.SchemaTable{Name: table.Name, Schema: table.Schema, Columns: make([]contracts.SchemaColumn, 0)}
	for rows.Next() {
		var column contracts.SchemaColumn
		if err := rows.Scan(&column.Name, &column.DataType, &column.Nullable, &column.IsPrimaryKey); err != nil {
			return contracts.SchemaTable{}, fmt.Errorf("scan column row for %s.%s: %w", table.Schema, table.Name, err)
		}
		item.Columns = append(item.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("iterate columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	return item, nil
}

func fetchMSSQLSchema(ctx context.Context, target *contracts.DatabaseTarget) (contracts.SchemaInfo, error) {
	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	defer sqlConn.Close()

	result := emptySchemaInfo()
	tables, err := loadTableRefs(ctx, sqlConn.conn, `
SELECT TABLE_SCHEMA, TABLE_NAME
FROM INFORMATION_SCHEMA.TABLES
WHERE TABLE_TYPE = 'BASE TABLE' AND TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA')
ORDER BY TABLE_SCHEMA, TABLE_NAME
`)
	if err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch tables: %w", err)
	}
	for _, table := range tables {
		item, err := loadMSSQLTable(ctx, sqlConn.conn, table)
		if err != nil {
			return contracts.SchemaInfo{}, err
		}
		result.Tables = append(result.Tables, item)
	}
	if err := loadSchemaViews(ctx, sqlConn.conn, &result, `
SELECT TABLE_SCHEMA, TABLE_NAME, CAST(0 AS bit)
FROM INFORMATION_SCHEMA.VIEWS
ORDER BY TABLE_SCHEMA, TABLE_NAME
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch views: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT ROUTINE_SCHEMA, ROUTINE_NAME, COALESCE(DATA_TYPE, '')
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_TYPE = 'FUNCTION'
ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
`, &result.Functions); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch functions: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT ROUTINE_SCHEMA, ROUTINE_NAME, ''
FROM INFORMATION_SCHEMA.ROUTINES
WHERE ROUTINE_TYPE = 'PROCEDURE'
ORDER BY ROUTINE_SCHEMA, ROUTINE_NAME
`, &result.Procedures); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch procedures: %w", err)
	}
	if err := loadSchemaTriggers(ctx, sqlConn.conn, &result, `
SELECT OBJECT_SCHEMA_NAME(parent_id), name, OBJECT_NAME(parent_id),
       CASE WHEN is_instead_of_trigger = 1 THEN 'INSTEAD OF' ELSE 'AFTER' END,
       type_desc
FROM sys.triggers
WHERE parent_class_desc = 'OBJECT_OR_COLUMN'
ORDER BY 1, 2
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch triggers: %w", err)
	}
	if err := loadSchemaSequences(ctx, sqlConn.conn, &result, `
SELECT SCHEMA_NAME(schema_id), name
FROM sys.sequences
ORDER BY 1, 2
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch sequences: %w", err)
	}
	if err := loadSchemaTypes(ctx, sqlConn.conn, &result, `
SELECT SCHEMA_NAME(schema_id), name,
       CASE WHEN is_table_type = 1 THEN 'TABLE' ELSE 'TYPE' END
FROM sys.types
WHERE is_user_defined = 1
ORDER BY 1, 2
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch types: %w", err)
	}
	return result, nil
}

func loadMSSQLTable(ctx context.Context, conn *sql.Conn, table objectRef) (contracts.SchemaTable, error) {
	rows, err := conn.QueryContext(ctx, `
SELECT c.COLUMN_NAME,
       c.DATA_TYPE,
       CASE WHEN c.IS_NULLABLE = 'YES' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END,
       CASE WHEN tc.CONSTRAINT_TYPE = 'PRIMARY KEY' THEN CAST(1 AS bit) ELSE CAST(0 AS bit) END
FROM INFORMATION_SCHEMA.COLUMNS c
LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
  ON c.TABLE_SCHEMA = kcu.TABLE_SCHEMA
 AND c.TABLE_NAME = kcu.TABLE_NAME
 AND c.COLUMN_NAME = kcu.COLUMN_NAME
LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
  ON kcu.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA
 AND kcu.CONSTRAINT_NAME = tc.CONSTRAINT_NAME
 AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
WHERE c.TABLE_SCHEMA = @p1 AND c.TABLE_NAME = @p2
ORDER BY c.ORDINAL_POSITION
`, table.Schema, table.Name)
	if err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("fetch columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	defer rows.Close()

	item := contracts.SchemaTable{Name: table.Name, Schema: table.Schema, Columns: make([]contracts.SchemaColumn, 0)}
	for rows.Next() {
		var column contracts.SchemaColumn
		if err := rows.Scan(&column.Name, &column.DataType, &column.Nullable, &column.IsPrimaryKey); err != nil {
			return contracts.SchemaTable{}, fmt.Errorf("scan column row for %s.%s: %w", table.Schema, table.Name, err)
		}
		item.Columns = append(item.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("iterate columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	return item, nil
}

func fetchOracleSchema(ctx context.Context, target *contracts.DatabaseTarget) (contracts.SchemaInfo, error) {
	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	defer sqlConn.Close()

	result := emptySchemaInfo()
	tables, err := loadTableRefs(ctx, sqlConn.conn, `
SELECT USER, table_name
FROM user_tables
ORDER BY table_name
`)
	if err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch tables: %w", err)
	}
	for _, table := range tables {
		item, err := loadOracleTable(ctx, sqlConn.conn, table)
		if err != nil {
			return contracts.SchemaInfo{}, err
		}
		result.Tables = append(result.Tables, item)
	}
	if err := loadSchemaViews(ctx, sqlConn.conn, &result, `
SELECT USER, view_name, 0
FROM user_views
ORDER BY view_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch views: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT USER, object_name, ''
FROM user_objects
WHERE object_type = 'FUNCTION'
ORDER BY object_name
`, &result.Functions); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch functions: %w", err)
	}
	if err := loadSchemaRoutines(ctx, sqlConn.conn, &result, `
SELECT USER, object_name, ''
FROM user_objects
WHERE object_type = 'PROCEDURE'
ORDER BY object_name
`, &result.Procedures); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch procedures: %w", err)
	}
	if err := loadSchemaTriggers(ctx, sqlConn.conn, &result, `
SELECT USER, trigger_name, table_name, trigger_type, triggering_event
FROM user_triggers
ORDER BY trigger_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch triggers: %w", err)
	}
	if err := loadSchemaSequences(ctx, sqlConn.conn, &result, `
SELECT USER, sequence_name
FROM user_sequences
ORDER BY sequence_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch sequences: %w", err)
	}
	if err := loadSchemaPackages(ctx, sqlConn.conn, &result, `
SELECT USER, pkg.object_name,
       CASE WHEN body.object_name IS NULL THEN 0 ELSE 1 END
FROM user_objects pkg
LEFT JOIN user_objects body
  ON body.object_name = pkg.object_name
 AND body.object_type = 'PACKAGE BODY'
WHERE pkg.object_type = 'PACKAGE'
ORDER BY pkg.object_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch packages: %w", err)
	}
	if err := loadSchemaTypes(ctx, sqlConn.conn, &result, `
SELECT USER, type_name, typecode
FROM user_types
ORDER BY type_name
`); err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch types: %w", err)
	}
	return result, nil
}

func loadOracleTable(ctx context.Context, conn *sql.Conn, table objectRef) (contracts.SchemaTable, error) {
	rows, err := conn.QueryContext(ctx, `
SELECT c.column_name,
       c.data_type,
       CASE WHEN c.nullable = 'Y' THEN 1 ELSE 0 END,
       CASE WHEN pk.column_name IS NULL THEN 0 ELSE 1 END
FROM user_tab_columns c
LEFT JOIN (
  SELECT cols.table_name, cols.column_name
  FROM user_constraints cons
  JOIN user_cons_columns cols
    ON cons.constraint_name = cols.constraint_name
  WHERE cons.constraint_type = 'P'
) pk
  ON pk.table_name = c.table_name
 AND pk.column_name = c.column_name
WHERE c.table_name = :1
ORDER BY c.column_id
`, strings.ToUpper(table.Name))
	if err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("fetch columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	defer rows.Close()

	item := contracts.SchemaTable{Name: table.Name, Schema: table.Schema, Columns: make([]contracts.SchemaColumn, 0)}
	for rows.Next() {
		var column contracts.SchemaColumn
		if err := rows.Scan(&column.Name, &column.DataType, &column.Nullable, &column.IsPrimaryKey); err != nil {
			return contracts.SchemaTable{}, fmt.Errorf("scan column row for %s.%s: %w", table.Schema, table.Name, err)
		}
		item.Columns = append(item.Columns, column)
	}
	if err := rows.Err(); err != nil {
		return contracts.SchemaTable{}, fmt.Errorf("iterate columns for %s.%s: %w", table.Schema, table.Name, err)
	}
	return item, nil
}

func explainSQLQuery(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryPlanRequest) (contracts.QueryPlanResponse, error) {
	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}
	defer sqlConn.Close()

	switch targetProtocol(target) {
	case protocolMySQL:
		rows, err := sqlConn.conn.QueryContext(ctx, `EXPLAIN FORMAT=JSON `+req.SQL)
		if err != nil {
			return contracts.QueryPlanResponse{}, fmt.Errorf("run explain: %w", err)
		}
		defer rows.Close()

		if !rows.Next() {
			if err := rows.Err(); err != nil {
				return contracts.QueryPlanResponse{}, fmt.Errorf("read explain row: %w", err)
			}
			return contracts.QueryPlanResponse{Supported: false}, nil
		}

		var payload any
		if err := rows.Scan(&payload); err != nil {
			return contracts.QueryPlanResponse{}, fmt.Errorf("scan explain values: %w", err)
		}
		plan, raw, err := normalizePlanValue(payload)
		if err != nil {
			return contracts.QueryPlanResponse{}, err
		}
		return contracts.QueryPlanResponse{Supported: true, Plan: plan, Format: "json", Raw: raw}, nil
	default:
		return contracts.QueryPlanResponse{Supported: false}, nil
	}
}

func introspectSQLQuery(ctx context.Context, target *contracts.DatabaseTarget, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	sqlConn, err := openSQLTargetConn(ctx, target)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	defer sqlConn.Close()

	switch targetProtocol(target) {
	case protocolMySQL:
		return introspectMySQL(ctx, sqlConn.conn, req)
	case protocolMSSQL:
		return introspectMSSQL(ctx, sqlConn.conn, req)
	case protocolOracle:
		return introspectOracle(ctx, sqlConn.conn, req)
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func introspectMySQL(ctx context.Context, conn *sql.Conn, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	ref := parseObjectRef(req.Target, "")
	switch req.Type {
	case "indexes":
		return queryIntrospectionSQL(ctx, conn, `
SELECT index_name, column_name, non_unique = 0 AS is_unique, seq_in_index, index_type, cardinality
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = ?
ORDER BY index_name, seq_in_index
`, ref.Name)
	case "statistics":
		if ref.Column != "" {
			return queryIntrospectionSQL(ctx, conn, `
SELECT index_name, column_name, cardinality, sub_part, nullable, index_type
FROM information_schema.statistics
WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?
ORDER BY index_name, seq_in_index
`, ref.Name, ref.Column)
		}
		return queryIntrospectionSQL(ctx, conn, `
SELECT table_name, column_name, data_type, column_type, is_nullable
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = ?
ORDER BY ordinal_position
`, ref.Name)
	case "foreign_keys":
		return queryIntrospectionSQL(ctx, conn, `
SELECT constraint_name, column_name, referenced_table_name AS referenced_table, referenced_column_name AS referenced_column
FROM information_schema.key_column_usage
WHERE table_schema = DATABASE() AND table_name = ? AND referenced_table_name IS NOT NULL
ORDER BY constraint_name, ordinal_position
`, ref.Name)
	case "table_schema":
		return queryIntrospectionSQL(ctx, conn, `
SELECT column_name, data_type, column_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = DATABASE() AND table_name = ?
ORDER BY ordinal_position
`, ref.Name)
	case "row_count":
		return queryIntrospectionSQL(ctx, conn, `
SELECT table_rows AS approximate_count
FROM information_schema.tables
WHERE table_schema = DATABASE() AND table_name = ?
`, ref.Name)
	case "database_version":
		return queryIntrospectionSQL(ctx, conn, `SELECT VERSION() AS version`)
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func introspectMSSQL(ctx context.Context, conn *sql.Conn, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	ref := parseObjectRef(req.Target, "dbo")
	switch req.Type {
	case "indexes":
		return queryIntrospectionSQL(ctx, conn, `
SELECT i.name AS index_name,
       STRING_AGG(c.name, ', ') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns,
       i.is_primary_key,
       i.is_unique,
       i.type_desc
FROM sys.indexes i
JOIN sys.tables t ON i.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
LEFT JOIN sys.index_columns ic
  ON i.object_id = ic.object_id AND i.index_id = ic.index_id AND ic.is_included_column = 0
LEFT JOIN sys.columns c
  ON ic.object_id = c.object_id AND ic.column_id = c.column_id
WHERE s.name = @p1 AND t.name = @p2 AND i.name IS NOT NULL
GROUP BY i.name, i.is_primary_key, i.is_unique, i.type_desc
ORDER BY i.name
`, ref.Schema, ref.Name)
	case "statistics":
		return queryIntrospectionSQL(ctx, conn, `
SELECT st.name AS statistic_name,
       c.name AS column_name,
       sp.last_updated,
       sp.rows,
       sp.rows_sampled,
       sp.modification_counter
FROM sys.stats st
JOIN sys.tables t ON st.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.stats_columns sc ON st.object_id = sc.object_id AND st.stats_id = sc.stats_id
JOIN sys.columns c ON sc.object_id = c.object_id AND sc.column_id = c.column_id
OUTER APPLY sys.dm_db_stats_properties(st.object_id, st.stats_id) sp
WHERE s.name = @p1 AND t.name = @p2
ORDER BY st.name, sc.stats_column_id
`, ref.Schema, ref.Name)
	case "foreign_keys":
		return queryIntrospectionSQL(ctx, conn, `
SELECT fk.name AS constraint_name,
       pc.name AS column_name,
       rt.name AS referenced_table,
       rc.name AS referenced_column
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc
  ON fk.object_id = fkc.constraint_object_id
JOIN sys.tables pt ON fk.parent_object_id = pt.object_id
JOIN sys.schemas ps ON pt.schema_id = ps.schema_id
JOIN sys.columns pc ON fkc.parent_object_id = pc.object_id AND fkc.parent_column_id = pc.column_id
JOIN sys.tables rt ON fk.referenced_object_id = rt.object_id
JOIN sys.columns rc ON fkc.referenced_object_id = rc.object_id AND fkc.referenced_column_id = rc.column_id
WHERE ps.name = @p1 AND pt.name = @p2
ORDER BY fk.name, fkc.constraint_column_id
`, ref.Schema, ref.Name)
	case "table_schema":
		return queryIntrospectionSQL(ctx, conn, `
SELECT COLUMN_NAME, DATA_TYPE, CHARACTER_MAXIMUM_LENGTH, COLUMN_DEFAULT, IS_NULLABLE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_SCHEMA = @p1 AND TABLE_NAME = @p2
ORDER BY ORDINAL_POSITION
`, ref.Schema, ref.Name)
	case "row_count":
		return queryIntrospectionSQL(ctx, conn, `
SELECT SUM(p.rows) AS approximate_count
FROM sys.partitions p
JOIN sys.tables t ON p.object_id = t.object_id
JOIN sys.schemas s ON t.schema_id = s.schema_id
WHERE s.name = @p1 AND t.name = @p2 AND p.index_id IN (0, 1)
`, ref.Schema, ref.Name)
	case "database_version":
		return queryIntrospectionSQL(ctx, conn, `SELECT @@VERSION AS version`)
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func introspectOracle(ctx context.Context, conn *sql.Conn, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	ref := parseObjectRef(req.Target, "")
	switch req.Type {
	case "indexes":
		return queryIntrospectionSQL(ctx, conn, `
SELECT idx.index_name, idx.column_name, ind.uniqueness, idx.column_position
FROM user_ind_columns idx
JOIN user_indexes ind ON idx.index_name = ind.index_name
WHERE idx.table_name = :1
ORDER BY idx.index_name, idx.column_position
`, strings.ToUpper(ref.Name))
	case "statistics":
		if ref.Column != "" {
			return queryIntrospectionSQL(ctx, conn, `
SELECT table_name, column_name, num_distinct, num_nulls, density, num_buckets, histogram
FROM user_tab_col_statistics
WHERE table_name = :1 AND column_name = :2
`, strings.ToUpper(ref.Name), strings.ToUpper(ref.Column))
		}
		return queryIntrospectionSQL(ctx, conn, `
SELECT table_name, column_name, num_distinct, num_nulls, density, num_buckets, histogram
FROM user_tab_col_statistics
WHERE table_name = :1
ORDER BY column_name
`, strings.ToUpper(ref.Name))
	case "foreign_keys":
		return queryIntrospectionSQL(ctx, conn, `
SELECT c.constraint_name,
       cc.column_name,
       r.table_name AS referenced_table,
       rc.column_name AS referenced_column
FROM user_constraints c
JOIN user_cons_columns cc
  ON c.constraint_name = cc.constraint_name
JOIN user_constraints r
  ON c.r_constraint_name = r.constraint_name
JOIN user_cons_columns rc
  ON r.constraint_name = rc.constraint_name
 AND rc.position = cc.position
WHERE c.constraint_type = 'R' AND c.table_name = :1
ORDER BY c.constraint_name, cc.position
`, strings.ToUpper(ref.Name))
	case "table_schema":
		return queryIntrospectionSQL(ctx, conn, `
SELECT column_name, data_type, data_length, data_precision, data_scale, data_default, nullable
FROM user_tab_columns
WHERE table_name = :1
ORDER BY column_id
`, strings.ToUpper(ref.Name))
	case "row_count":
		return queryIntrospectionSQL(ctx, conn, `
SELECT num_rows AS approximate_count
FROM user_tables
WHERE table_name = :1
`, strings.ToUpper(ref.Name))
	case "database_version":
		return queryIntrospectionSQL(ctx, conn, `
SELECT banner AS version
FROM v$version
WHERE ROWNUM = 1
`)
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func queryIntrospectionSQL(ctx context.Context, conn *sql.Conn, query string, args ...any) (contracts.QueryIntrospectionResponse, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	defer rows.Close()

	records, err := rowsToMapsSQL(rows)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	if len(records) == 1 {
		return contracts.QueryIntrospectionResponse{Supported: true, Data: records[0]}, nil
	}
	return contracts.QueryIntrospectionResponse{Supported: true, Data: records}, nil
}

func rowsToMapsSQL(rows *sql.Rows) ([]map[string]any, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("read columns: %w", err)
	}

	result := make([]map[string]any, 0)
	for rows.Next() {
		values := make([]any, len(columns))
		dest := make([]any, len(columns))
		for i := range values {
			dest[i] = &values[i]
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, fmt.Errorf("scan row values: %w", err)
		}
		record := make(map[string]any, len(columns))
		for idx, column := range columns {
			record[column] = normalizeValue(values[idx])
		}
		result = append(result, record)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate rows: %w", err)
	}
	return result, nil
}

func emptySchemaInfo() contracts.SchemaInfo {
	return contracts.SchemaInfo{
		Tables:     make([]contracts.SchemaTable, 0),
		Views:      make([]contracts.SchemaView, 0),
		Functions:  make([]contracts.SchemaRoutine, 0),
		Procedures: make([]contracts.SchemaRoutine, 0),
		Triggers:   make([]contracts.SchemaTrigger, 0),
		Sequences:  make([]contracts.SchemaSequence, 0),
		Packages:   make([]contracts.SchemaPackage, 0),
		Types:      make([]contracts.SchemaNamedType, 0),
	}
}

func loadTableRefs(ctx context.Context, conn *sql.Conn, query string, args ...any) ([]objectRef, error) {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]objectRef, 0)
	for rows.Next() {
		var ref objectRef
		if err := rows.Scan(&ref.Schema, &ref.Name); err != nil {
			return nil, err
		}
		result = append(result, ref)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func loadSchemaViews(ctx context.Context, conn *sql.Conn, result *contracts.SchemaInfo, query string, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var view contracts.SchemaView
		if err := rows.Scan(&view.Schema, &view.Name, &view.Materialized); err != nil {
			return err
		}
		result.Views = append(result.Views, view)
	}
	return rows.Err()
}

func loadSchemaRoutines(ctx context.Context, conn *sql.Conn, _ *contracts.SchemaInfo, query string, out *[]contracts.SchemaRoutine, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item contracts.SchemaRoutine
		if err := rows.Scan(&item.Schema, &item.Name, &item.ReturnType); err != nil {
			return err
		}
		*out = append(*out, item)
	}
	return rows.Err()
}

func loadSchemaTriggers(ctx context.Context, conn *sql.Conn, result *contracts.SchemaInfo, query string, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item contracts.SchemaTrigger
		if err := rows.Scan(&item.Schema, &item.Name, &item.TableName, &item.Timing, &item.Event); err != nil {
			return err
		}
		result.Triggers = append(result.Triggers, item)
	}
	return rows.Err()
}

func loadSchemaSequences(ctx context.Context, conn *sql.Conn, result *contracts.SchemaInfo, query string, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item contracts.SchemaSequence
		if err := rows.Scan(&item.Schema, &item.Name); err != nil {
			return err
		}
		result.Sequences = append(result.Sequences, item)
	}
	return rows.Err()
}

func loadSchemaPackages(ctx context.Context, conn *sql.Conn, result *contracts.SchemaInfo, query string, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item contracts.SchemaPackage
		if err := rows.Scan(&item.Schema, &item.Name, &item.HasBody); err != nil {
			return err
		}
		result.Packages = append(result.Packages, item)
	}
	return rows.Err()
}

func loadSchemaTypes(ctx context.Context, conn *sql.Conn, result *contracts.SchemaInfo, query string, args ...any) error {
	rows, err := conn.QueryContext(ctx, query, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var item contracts.SchemaNamedType
		if err := rows.Scan(&item.Schema, &item.Name, &item.Kind); err != nil {
			return err
		}
		result.Types = append(result.Types, item)
	}
	return rows.Err()
}

func parseObjectRef(target, defaultSchema string) objectRef {
	parts := splitObjectTarget(target)
	switch len(parts) {
	case 0:
		return objectRef{Schema: defaultSchema}
	case 1:
		return objectRef{Schema: defaultSchema, Name: parts[0]}
	case 2:
		return objectRef{Schema: defaultSchema, Name: parts[0], Column: parts[1]}
	default:
		return objectRef{
			Schema: parts[len(parts)-3],
			Name:   parts[len(parts)-2],
			Column: parts[len(parts)-1],
		}
	}
}

func splitObjectTarget(target string) []string {
	rawParts := strings.Split(strings.TrimSpace(target), ".")
	parts := make([]string, 0, len(rawParts))
	for _, part := range rawParts {
		part = normalizeIdentifierToken(part)
		if part != "" {
			parts = append(parts, part)
		}
	}
	return parts
}

func normalizeIdentifierToken(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, `"'`)
	value = strings.TrimPrefix(value, "[")
	value = strings.TrimSuffix(value, "]")
	return value
}

func normalizePlanValue(value any) (any, string, error) {
	normalized := normalizeValue(value)
	switch typed := normalized.(type) {
	case string:
		var decoded any
		if err := json.Unmarshal([]byte(typed), &decoded); err != nil {
			return normalized, typed, nil
		}
		pretty, err := json.MarshalIndent(decoded, "", "  ")
		if err != nil {
			return decoded, typed, nil
		}
		return decoded, string(pretty), nil
	default:
		pretty, err := json.MarshalIndent(normalized, "", "  ")
		if err != nil {
			return normalized, fmt.Sprintf("%v", normalized), nil
		}
		return normalized, string(pretty), nil
	}
}
