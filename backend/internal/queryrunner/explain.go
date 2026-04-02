package queryrunner

import (
	"context"
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func ValidateExplainSQL(sql string) error {
	trimmed := strings.TrimSpace(sql)
	if trimmed == "" {
		return fmt.Errorf("sql is required")
	}
	if hasMultipleStatements(trimmed) {
		return fmt.Errorf("multiple SQL statements are not allowed")
	}
	return nil
}

func ExplainQuery(ctx context.Context, defaultPool poolLike, req contracts.QueryPlanRequest) (contracts.QueryPlanResponse, error) {
	if err := ValidateExplainSQL(req.SQL); err != nil {
		return contracts.QueryPlanResponse{}, err
	}

	switch targetProtocol(req.Target) {
	case protocolMySQL, protocolMSSQL, protocolOracle:
		return explainSQLQuery(ctx, req.Target, req)
	case protocolMongoDB:
		return explainMongoQuery(ctx, req.Target, req)
	}

	queryPool, cleanup, err := resolvePool(ctx, defaultPool, contracts.QueryExecutionRequest{
		SQL:    "SELECT 1",
		Target: req.Target,
	})
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}
	defer cleanup()

	queryCtx, cancel := context.WithTimeout(ctx, defaultQueryTimeout)
	defer cancel()

	rows, err := queryPool.Query(queryCtx, `EXPLAIN (ANALYZE false, FORMAT JSON) `+req.SQL)
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

	values, err := rows.Values()
	if err != nil {
		return contracts.QueryPlanResponse{}, fmt.Errorf("scan explain values: %w", err)
	}
	if len(values) == 0 {
		return contracts.QueryPlanResponse{Supported: false}, nil
	}

	plan, raw, err := normalizePlanValue(values[0])
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}

	return contracts.QueryPlanResponse{
		Supported: true,
		Plan:      plan,
		Format:    "json",
		Raw:       raw,
	}, nil
}
