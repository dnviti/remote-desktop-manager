package queryrunner

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func ValidateExecutableSQL(sql string) error {
	if strings.TrimSpace(sql) == "" {
		return fmt.Errorf("sql is required")
	}
	return nil
}

func ExecuteQuery(ctx context.Context, defaultPool poolLike, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	switch targetProtocol(req.Target) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		return executeSQLAny(ctx, req.Target, req)
	case protocolMongoDB:
		return executeMongoAny(ctx, req.Target, req)
	}

	if err := ValidateExecutableSQL(req.SQL); err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	maxRows := req.MaxRows
	switch {
	case maxRows <= 0:
		maxRows = defaultMaxRows
	case maxRows > maxAllowedRows:
		maxRows = maxAllowedRows
	}

	queryPool, cleanup, err := resolvePool(ctx, defaultPool, req)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	defer cleanup()

	statements := splitStatements(req.SQL)
	if len(statements) == 0 {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("sql is required")
	}

	start := time.Now()
	var result contracts.QueryExecutionResponse
	for _, stmt := range statements {
		queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
		result, err = executeSingleStatement(queryCtx, queryPool, stmt, maxRows)
		cancel()
		if err != nil {
			return contracts.QueryExecutionResponse{}, err
		}
	}
	result.DurationMs = time.Since(start).Milliseconds()
	return result, nil
}

func executeSingleStatement(ctx context.Context, queryPool poolLike, stmt string, maxRows int) (contracts.QueryExecutionResponse, error) {
	rows, err := queryPool.Query(ctx, stmt)
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

	if len(columns) == 0 {
		for rows.Next() {
		}
		if err := rows.Err(); err != nil {
			return contracts.QueryExecutionResponse{}, fmt.Errorf("iterate rows: %w", err)
		}
		result.RowCount = int(rows.CommandTag().RowsAffected())
		return result, nil
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
			continue
		}

		result.Truncated = true
		break
	}

	if err := rows.Err(); err != nil {
		return contracts.QueryExecutionResponse{}, fmt.Errorf("iterate rows: %w", err)
	}

	return result, nil
}

func splitStatements(sql string) []string {
	statements := make([]string, 0, 4)
	cur := 0
	statementStart := 0
	length := len(sql)

	for cur < length {
		ch := sql[cur]

		if ch == '\'' {
			cur++
			for cur < length {
				if sql[cur] == '\'' {
					cur++
					if cur < length && sql[cur] == '\'' {
						cur++
						continue
					}
					break
				}
				cur++
			}
			continue
		}

		if ch == '"' {
			cur++
			for cur < length && sql[cur] != '"' {
				cur++
			}
			if cur < length {
				cur++
			}
			continue
		}

		if ch == '-' && cur+1 < length && sql[cur+1] == '-' {
			cur += 2
			for cur < length && sql[cur] != '\n' {
				cur++
			}
			continue
		}

		if ch == '/' && cur+1 < length && sql[cur+1] == '*' {
			cur += 2
			for cur+1 < length && !(sql[cur] == '*' && sql[cur+1] == '/') {
				cur++
			}
			if cur+1 < length {
				cur += 2
			}
			continue
		}

		if ch == ';' {
			stmt := strings.TrimSpace(sql[statementStart:cur])
			if stmt != "" {
				statements = append(statements, stmt)
			}
			cur++
			statementStart = cur
			continue
		}

		cur++
	}

	last := strings.TrimSpace(sql[statementStart:])
	if last != "" {
		statements = append(statements, last)
	}
	return statements
}

func ValidateConnectivity(ctx context.Context, defaultPool poolLike, target *contracts.DatabaseTarget) error {
	if target == nil {
		return fmt.Errorf("target is required")
	}

	switch targetProtocol(target) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		sqlConn, err := openSQLTargetConn(ctx, target)
		if err != nil {
			return err
		}
		sqlConn.Close()
		return nil
	case protocolMongoDB:
		mongoConn, err := openMongoTarget(ctx, target)
		if err != nil {
			return err
		}
		mongoConn.Close()
		return nil
	}

	queryPool, cleanup, err := resolvePool(ctx, defaultPool, contracts.QueryExecutionRequest{
		SQL:    "SELECT 1",
		Target: target,
	})
	if err != nil {
		return err
	}
	defer cleanup()

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	rows, err := queryPool.Query(queryCtx, "SELECT 1")
	if err != nil {
		return fmt.Errorf("execute connectivity probe: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		break
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate connectivity probe: %w", err)
	}

	return nil
}
