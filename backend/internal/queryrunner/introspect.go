package queryrunner

import (
	"context"
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5"
)

var validIntrospectionTypes = map[string]struct{}{
	"indexes":          {},
	"statistics":       {},
	"foreign_keys":     {},
	"table_schema":     {},
	"row_count":        {},
	"database_version": {},
}

func ValidateIntrospectionRequest(req contracts.QueryIntrospectionRequest) error {
	requestType := strings.TrimSpace(req.Type)
	if requestType == "" {
		return fmt.Errorf("type is required")
	}
	if _, ok := validIntrospectionTypes[requestType]; !ok {
		return fmt.Errorf("unsupported introspection type %q", req.Type)
	}
	if requestType != "database_version" && strings.TrimSpace(req.Target) == "" {
		return fmt.Errorf("target is required for introspection type %q", req.Type)
	}
	return nil
}

func IntrospectQuery(ctx context.Context, defaultPool poolLike, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	if err := ValidateIntrospectionRequest(req); err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}

	switch targetProtocol(req.DB) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		return introspectSQLQuery(ctx, req.DB, req)
	case protocolMongoDB:
		return introspectMongoQuery(ctx, req.DB, req)
	}

	queryPool, cleanup, err := resolvePool(ctx, defaultPool, contracts.QueryExecutionRequest{
		SQL:    "SELECT 1",
		Target: req.DB,
	})
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	defer cleanup()

	switch req.Type {
	case "indexes":
		return postgresIndexes(ctx, queryPool, req.Target)
	case "statistics":
		return postgresStatistics(ctx, queryPool, req.Target)
	case "foreign_keys":
		return postgresForeignKeys(ctx, queryPool, req.Target)
	case "table_schema":
		return postgresTableSchema(ctx, queryPool, req.Target)
	case "row_count":
		return postgresRowCount(ctx, queryPool, req.Target)
	case "database_version":
		return postgresDatabaseVersion(ctx, queryPool)
	default:
		return contracts.QueryIntrospectionResponse{Supported: false}, nil
	}
}

func postgresIndexes(ctx context.Context, queryPool poolLike, table string) (contracts.QueryIntrospectionResponse, error) {
	rows, err := queryPool.Query(ctx, `
		SELECT indexname AS index_name,
		       indexdef AS definition,
		       array_to_string(ARRAY(
		         SELECT a.attname
		         FROM pg_index i
		         JOIN pg_class c ON c.oid = i.indexrelid
		         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
		         WHERE c.relname = idx.indexname
		       ), ', ') AS columns,
		       idx.indexname LIKE '%_pkey' AS is_primary,
		       (SELECT i.indisunique FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = idx.indexname LIMIT 1) AS is_unique
		FROM pg_indexes idx
		WHERE tablename = $1
		ORDER BY indexname
	`, table)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch indexes: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func postgresStatistics(ctx context.Context, queryPool poolLike, target string) (contracts.QueryIntrospectionResponse, error) {
	table, column, _ := strings.Cut(target, ".")
	query := `
		SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width
		FROM pg_stats
		WHERE tablename = $1
	`
	args := []any{table}
	if column != "" {
		query = `
			SELECT schemaname, tablename, attname, n_distinct, null_frac, avg_width,
			       most_common_vals::text, most_common_freqs::text
			FROM pg_stats
			WHERE tablename = $1 AND attname = $2
		`
		args = append(args, column)
	}

	rows, err := queryPool.Query(ctx, query, args...)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch statistics: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func postgresForeignKeys(ctx context.Context, queryPool poolLike, table string) (contracts.QueryIntrospectionResponse, error) {
	rows, err := queryPool.Query(ctx, `
		SELECT
		  tc.constraint_name,
		  kcu.column_name,
		  ccu.table_name AS referenced_table,
		  ccu.column_name AS referenced_column
		FROM information_schema.table_constraints tc
		JOIN information_schema.key_column_usage kcu
		  ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
		JOIN information_schema.constraint_column_usage ccu
		  ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
		WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name = $1
		ORDER BY tc.constraint_name
	`, table)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch foreign keys: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func postgresTableSchema(ctx context.Context, queryPool poolLike, table string) (contracts.QueryIntrospectionResponse, error) {
	rows, err := queryPool.Query(ctx, `
		SELECT column_name, data_type, character_maximum_length, column_default,
		       is_nullable, udt_name
		FROM information_schema.columns
		WHERE table_name = $1
		ORDER BY ordinal_position
	`, table)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch table schema: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func postgresRowCount(ctx context.Context, queryPool poolLike, table string) (contracts.QueryIntrospectionResponse, error) {
	rows, err := queryPool.Query(ctx, `
		SELECT reltuples::bigint AS approximate_count
		FROM pg_class WHERE relname = $1
	`, table)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch row count: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func postgresDatabaseVersion(ctx context.Context, queryPool poolLike) (contracts.QueryIntrospectionResponse, error) {
	rows, err := queryPool.Query(ctx, `SELECT version() AS version`)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, fmt.Errorf("fetch database version: %w", err)
	}
	defer rows.Close()

	return rowsToIntrospectionResponse(rows)
}

func rowsToIntrospectionResponse(rows pgx.Rows) (contracts.QueryIntrospectionResponse, error) {
	records, err := rowsToMaps(rows)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	if len(records) == 1 {
		return contracts.QueryIntrospectionResponse{Supported: true, Data: records[0]}, nil
	}
	return contracts.QueryIntrospectionResponse{Supported: true, Data: records}, nil
}

func rowsToMaps(rows pgx.Rows) ([]map[string]any, error) {
	fieldDescriptions := rows.FieldDescriptions()
	columns := make([]string, len(fieldDescriptions))
	for i, field := range fieldDescriptions {
		columns[i] = string(field.Name)
	}

	result := make([]map[string]any, 0)
	for rows.Next() {
		values, err := rows.Values()
		if err != nil {
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
