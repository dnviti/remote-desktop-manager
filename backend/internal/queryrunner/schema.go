package queryrunner

import (
	"context"
	"fmt"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func FetchSchema(ctx context.Context, defaultPool poolLike, req contracts.SchemaFetchRequest) (contracts.SchemaInfo, error) {
	switch targetProtocol(req.Target) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		return fetchSQLSchema(ctx, req.Target)
	case protocolMongoDB:
		return fetchMongoSchema(ctx, req.Target)
	}

	queryPool, cleanup, err := resolveSchemaPool(ctx, defaultPool, req)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	defer cleanup()

	result := contracts.SchemaInfo{
		Tables:     make([]contracts.SchemaTable, 0),
		Views:      make([]contracts.SchemaView, 0),
		Functions:  make([]contracts.SchemaRoutine, 0),
		Procedures: make([]contracts.SchemaRoutine, 0),
		Triggers:   make([]contracts.SchemaTrigger, 0),
		Sequences:  make([]contracts.SchemaSequence, 0),
		Packages:   make([]contracts.SchemaPackage, 0),
		Types:      make([]contracts.SchemaNamedType, 0),
	}

	tablesRows, err := queryPool.Query(ctx, `
		SELECT table_schema, table_name
		FROM information_schema.tables
		WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
		  AND table_type = 'BASE TABLE'
		ORDER BY table_schema, table_name
	`)
	if err != nil {
		return contracts.SchemaInfo{}, fmt.Errorf("fetch tables: %w", err)
	}

	var tables []struct {
		Schema string
		Name   string
	}
	for tablesRows.Next() {
		var row struct {
			Schema string
			Name   string
		}
		if err := tablesRows.Scan(&row.Schema, &row.Name); err != nil {
			tablesRows.Close()
			return contracts.SchemaInfo{}, fmt.Errorf("scan table row: %w", err)
		}
		tables = append(tables, row)
	}
	if err := tablesRows.Err(); err != nil {
		tablesRows.Close()
		return contracts.SchemaInfo{}, fmt.Errorf("iterate table rows: %w", err)
	}
	tablesRows.Close()

	for _, table := range tables {
		columnsRows, err := queryPool.Query(ctx, `
			SELECT
			  c.column_name,
			  c.data_type,
			  c.is_nullable = 'YES' AS nullable,
			  COALESCE(bool_or(tc.constraint_type = 'PRIMARY KEY'), false) AS is_primary_key
			FROM information_schema.columns c
			LEFT JOIN information_schema.key_column_usage kcu
			  ON c.table_schema = kcu.table_schema
			  AND c.table_name = kcu.table_name
			  AND c.column_name = kcu.column_name
			LEFT JOIN information_schema.table_constraints tc
			  ON kcu.constraint_name = tc.constraint_name
			  AND kcu.table_schema = tc.table_schema
			  AND tc.constraint_type = 'PRIMARY KEY'
			WHERE c.table_schema = $1 AND c.table_name = $2
			GROUP BY c.column_name, c.data_type, c.is_nullable, c.ordinal_position
			ORDER BY c.ordinal_position
		`, table.Schema, table.Name)
		if err != nil {
			return contracts.SchemaInfo{}, fmt.Errorf("fetch columns for %s.%s: %w", table.Schema, table.Name, err)
		}

		schemaTable := contracts.SchemaTable{
			Name:    table.Name,
			Schema:  table.Schema,
			Columns: make([]contracts.SchemaColumn, 0),
		}
		for columnsRows.Next() {
			var column contracts.SchemaColumn
			if err := columnsRows.Scan(&column.Name, &column.DataType, &column.Nullable, &column.IsPrimaryKey); err != nil {
				columnsRows.Close()
				return contracts.SchemaInfo{}, fmt.Errorf("scan column row for %s.%s: %w", table.Schema, table.Name, err)
			}
			schemaTable.Columns = append(schemaTable.Columns, column)
		}
		if err := columnsRows.Err(); err != nil {
			columnsRows.Close()
			return contracts.SchemaInfo{}, fmt.Errorf("iterate columns for %s.%s: %w", table.Schema, table.Name, err)
		}
		columnsRows.Close()
		result.Tables = append(result.Tables, schemaTable)
	}

	if err := fetchViews(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}
	if err := fetchFunctions(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}
	if err := fetchProcedures(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}
	if err := fetchTriggers(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}
	if err := fetchSequences(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}
	if err := fetchTypes(ctx, queryPool, &result); err != nil {
		return contracts.SchemaInfo{}, err
	}

	return result, nil
}

func resolveSchemaPool(ctx context.Context, defaultPool poolLike, req contracts.SchemaFetchRequest) (poolLike, func(), error) {
	pool, cleanup, err := resolvePool(ctx, defaultPool, contracts.QueryExecutionRequest{
		SQL:    "SELECT 1",
		Target: req.Target,
	})
	if err != nil {
		return nil, nil, err
	}
	return pool, cleanup, nil
}

func fetchViews(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT schemaname AS schema, viewname AS name, false AS materialized
		FROM pg_catalog.pg_views
		WHERE schemaname NOT IN ('pg_catalog','information_schema')
		UNION ALL
		SELECT schemaname AS schema, matviewname AS name, true AS materialized
		FROM pg_catalog.pg_matviews
		WHERE schemaname NOT IN ('pg_catalog','information_schema')
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch views: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var view contracts.SchemaView
		if err := rows.Scan(&view.Schema, &view.Name, &view.Materialized); err != nil {
			return fmt.Errorf("scan view row: %w", err)
		}
		result.Views = append(result.Views, view)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate views: %w", err)
	}
	return nil
}

func fetchFunctions(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT n.nspname AS schema, p.proname AS name,
		       pg_get_function_result(p.oid) AS return_type
		FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
		WHERE p.prokind = 'f'
		  AND n.nspname NOT IN ('pg_catalog','information_schema')
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch functions: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var routine contracts.SchemaRoutine
		if err := rows.Scan(&routine.Schema, &routine.Name, &routine.ReturnType); err != nil {
			return fmt.Errorf("scan function row: %w", err)
		}
		result.Functions = append(result.Functions, routine)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate functions: %w", err)
	}
	return nil
}

func fetchProcedures(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT n.nspname AS schema, p.proname AS name
		FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
		WHERE p.prokind = 'p'
		  AND n.nspname NOT IN ('pg_catalog','information_schema')
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch procedures: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var routine contracts.SchemaRoutine
		if err := rows.Scan(&routine.Schema, &routine.Name); err != nil {
			return fmt.Errorf("scan procedure row: %w", err)
		}
		result.Procedures = append(result.Procedures, routine)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate procedures: %w", err)
	}
	return nil
}

func fetchTriggers(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT trigger_schema AS schema, trigger_name AS name,
		       event_object_table AS table_name,
		       action_timing AS timing,
		       string_agg(DISTINCT event_manipulation, ',') AS event
		FROM information_schema.triggers
		WHERE trigger_schema NOT IN ('pg_catalog','information_schema')
		GROUP BY trigger_schema, trigger_name, event_object_table, action_timing
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch triggers: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var trigger contracts.SchemaTrigger
		if err := rows.Scan(&trigger.Schema, &trigger.Name, &trigger.TableName, &trigger.Timing, &trigger.Event); err != nil {
			return fmt.Errorf("scan trigger row: %w", err)
		}
		result.Triggers = append(result.Triggers, trigger)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate triggers: %w", err)
	}
	return nil
}

func fetchSequences(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT schemaname AS schema, sequencename AS name
		FROM pg_catalog.pg_sequences
		WHERE schemaname NOT IN ('pg_catalog','information_schema')
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch sequences: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var sequence contracts.SchemaSequence
		if err := rows.Scan(&sequence.Schema, &sequence.Name); err != nil {
			return fmt.Errorf("scan sequence row: %w", err)
		}
		result.Sequences = append(result.Sequences, sequence)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate sequences: %w", err)
	}
	return nil
}

func fetchTypes(ctx context.Context, queryPool poolLike, result *contracts.SchemaInfo) error {
	rows, err := queryPool.Query(ctx, `
		SELECT n.nspname AS schema, t.typname AS name,
		  CASE t.typtype WHEN 'e' THEN 'enum' WHEN 'c' THEN 'composite'
		    WHEN 'd' THEN 'domain' WHEN 'r' THEN 'range' ELSE 'other' END AS kind
		FROM pg_type t JOIN pg_namespace n ON t.typnamespace = n.oid
		WHERE t.typtype IN ('e','c','d','r')
		  AND n.nspname NOT IN ('pg_catalog','information_schema')
		  AND t.typname NOT LIKE '\_%'
		ORDER BY 1, 2
	`)
	if err != nil {
		return fmt.Errorf("fetch types: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var namedType contracts.SchemaNamedType
		if err := rows.Scan(&namedType.Schema, &namedType.Name, &namedType.Kind); err != nil {
			return fmt.Errorf("scan type row: %w", err)
		}
		result.Types = append(result.Types, namedType)
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate types: %w", err)
	}
	return nil
}
