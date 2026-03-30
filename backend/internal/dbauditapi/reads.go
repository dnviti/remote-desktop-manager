package dbauditapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
)

func (s Service) ListLogs(ctx context.Context, tenantID string, query dbAuditQuery) (paginatedDbAuditLogs, error) {
	if s.DB == nil {
		return paginatedDbAuditLogs{}, errors.New("database is unavailable")
	}

	whereClause, args := buildFilters(query, tenantID)
	countSQL := `SELECT COUNT(*) FROM "DbAuditLog" l` + whereClause

	var total int
	if err := s.DB.QueryRow(ctx, countSQL, args...).Scan(&total); err != nil {
		return paginatedDbAuditLogs{}, fmt.Errorf("count db audit logs: %w", err)
	}

	listArgs := append([]any{}, args...)
	listArgs = append(listArgs, query.Limit, (query.Page-1)*query.Limit)

	querySQL := `
SELECT
	l.id,
	l."userId",
	l."connectionId",
	l."tenantId",
	l."queryText",
	l."queryType"::text,
	l."tablesAccessed",
	l."rowsAffected",
	l."executionTimeMs",
	l.blocked,
	l."blockReason",
	l."executionPlan",
	l."createdAt",
	u.username,
	u.email,
	c.name
FROM "DbAuditLog" l
LEFT JOIN "User" u ON u.id = l."userId"
LEFT JOIN "Connection" c ON c.id = l."connectionId"` + whereClause + `
ORDER BY ` + orderByClause(query) + `
LIMIT $` + strconv.Itoa(len(args)+1) + ` OFFSET $` + strconv.Itoa(len(args)+2)

	rows, err := s.DB.Query(ctx, querySQL, listArgs...)
	if err != nil {
		return paginatedDbAuditLogs{}, fmt.Errorf("list db audit logs: %w", err)
	}
	defer rows.Close()

	items := make([]dbAuditLogEntry, 0)
	for rows.Next() {
		var (
			item            dbAuditLogEntry
			tenantIDValue   sql.NullString
			rowsAffected    sql.NullInt32
			executionTimeMS sql.NullInt32
			blockReason     sql.NullString
			executionPlan   []byte
			userName        sql.NullString
			userEmail       sql.NullString
			connectionName  sql.NullString
		)
		if err := rows.Scan(
			&item.ID,
			&item.UserID,
			&item.ConnectionID,
			&tenantIDValue,
			&item.QueryText,
			&item.QueryType,
			&item.TablesAccessed,
			&rowsAffected,
			&executionTimeMS,
			&item.Blocked,
			&blockReason,
			&executionPlan,
			&item.CreatedAt,
			&userName,
			&userEmail,
			&connectionName,
		); err != nil {
			return paginatedDbAuditLogs{}, fmt.Errorf("scan db audit log: %w", err)
		}
		if tenantIDValue.Valid {
			item.TenantID = &tenantIDValue.String
		}
		if rowsAffected.Valid {
			value := int(rowsAffected.Int32)
			item.RowsAffected = &value
		}
		if executionTimeMS.Valid {
			value := int(executionTimeMS.Int32)
			item.ExecutionTimeMS = &value
		}
		if blockReason.Valid {
			item.BlockReason = &blockReason.String
		}
		if userName.Valid {
			item.UserName = &userName.String
		}
		if userEmail.Valid {
			item.UserEmail = &userEmail.String
		}
		if connectionName.Valid {
			item.ConnectionName = &connectionName.String
		}
		if len(executionPlan) > 0 && string(executionPlan) != "null" {
			var decoded any
			if err := json.Unmarshal(executionPlan, &decoded); err == nil {
				item.ExecutionPlan = decoded
			}
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return paginatedDbAuditLogs{}, fmt.Errorf("iterate db audit logs: %w", err)
	}

	return paginatedDbAuditLogs{
		Data:       items,
		Total:      total,
		Page:       query.Page,
		Limit:      query.Limit,
		TotalPages: totalPages(total, query.Limit),
	}, nil
}

func (s Service) ListConnections(ctx context.Context, tenantID string) ([]dbAuditConnection, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT c.id, c.name
FROM "DbAuditLog" l
JOIN "Connection" c ON c.id = l."connectionId"
WHERE l."tenantId" = $1
ORDER BY c.name ASC, c.id ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list db audit connections: %w", err)
	}
	defer rows.Close()

	items := make([]dbAuditConnection, 0)
	for rows.Next() {
		var item dbAuditConnection
		if err := rows.Scan(&item.ID, &item.Name); err != nil {
			return nil, fmt.Errorf("scan db audit connection: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate db audit connections: %w", err)
	}
	return items, nil
}

func (s Service) ListUsers(ctx context.Context, tenantID string) ([]dbAuditUser, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT u.id, u.username, u.email
FROM "DbAuditLog" l
JOIN "User" u ON u.id = l."userId"
WHERE l."tenantId" = $1
ORDER BY u.email ASC, u.id ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list db audit users: %w", err)
	}
	defer rows.Close()

	items := make([]dbAuditUser, 0)
	for rows.Next() {
		var (
			item     dbAuditUser
			username sql.NullString
		)
		if err := rows.Scan(&item.ID, &username, &item.Email); err != nil {
			return nil, fmt.Errorf("scan db audit user: %w", err)
		}
		if username.Valid {
			item.Username = &username.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate db audit users: %w", err)
	}
	return items, nil
}

func (s Service) ListFirewallRules(ctx context.Context, tenantID string) ([]firewallRule, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, pattern, action::text, scope, description, enabled, priority, "createdAt", "updatedAt"
FROM "DbFirewallRule"
WHERE "tenantId" = $1
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list firewall rules: %w", err)
	}
	defer rows.Close()
	return scanFirewallRules(rows)
}

func (s Service) GetFirewallRule(ctx context.Context, tenantID, ruleID string) (firewallRule, error) {
	if s.DB == nil {
		return firewallRule{}, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, pattern, action::text, scope, description, enabled, priority, "createdAt", "updatedAt"
FROM "DbFirewallRule"
WHERE id = $1 AND "tenantId" = $2
`, ruleID, tenantID)
	if err != nil {
		return firewallRule{}, fmt.Errorf("get firewall rule: %w", err)
	}
	defer rows.Close()
	items, err := scanFirewallRules(rows)
	if err != nil {
		return firewallRule{}, err
	}
	if len(items) == 0 {
		return firewallRule{}, sql.ErrNoRows
	}
	return items[0], nil
}

func (s Service) ListMaskingPolicies(ctx context.Context, tenantID string) ([]maskingPolicy, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, "columnPattern", strategy::text, "exemptRoles", scope, description, enabled, "createdAt", "updatedAt"
FROM "DbMaskingPolicy"
WHERE "tenantId" = $1
ORDER BY "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list masking policies: %w", err)
	}
	defer rows.Close()
	return scanMaskingPolicies(rows)
}

func (s Service) GetMaskingPolicy(ctx context.Context, tenantID, policyID string) (maskingPolicy, error) {
	if s.DB == nil {
		return maskingPolicy{}, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, "columnPattern", strategy::text, "exemptRoles", scope, description, enabled, "createdAt", "updatedAt"
FROM "DbMaskingPolicy"
WHERE id = $1 AND "tenantId" = $2
`, policyID, tenantID)
	if err != nil {
		return maskingPolicy{}, fmt.Errorf("get masking policy: %w", err)
	}
	defer rows.Close()
	items, err := scanMaskingPolicies(rows)
	if err != nil {
		return maskingPolicy{}, err
	}
	if len(items) == 0 {
		return maskingPolicy{}, sql.ErrNoRows
	}
	return items[0], nil
}

func (s Service) ListRateLimitPolicies(ctx context.Context, tenantID string) ([]rateLimitPolicy, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, "queryType"::text, "windowMs", "maxQueries", "burstMax", "exemptRoles", scope, action::text, enabled, priority, "createdAt", "updatedAt"
FROM "DbRateLimitPolicy"
WHERE "tenantId" = $1
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list rate limit policies: %w", err)
	}
	defer rows.Close()
	return scanRateLimitPolicies(rows)
}

func (s Service) GetRateLimitPolicy(ctx context.Context, tenantID, policyID string) (rateLimitPolicy, error) {
	if s.DB == nil {
		return rateLimitPolicy{}, errors.New("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, `
SELECT id, "tenantId", name, "queryType"::text, "windowMs", "maxQueries", "burstMax", "exemptRoles", scope, action::text, enabled, priority, "createdAt", "updatedAt"
FROM "DbRateLimitPolicy"
WHERE id = $1 AND "tenantId" = $2
`, policyID, tenantID)
	if err != nil {
		return rateLimitPolicy{}, fmt.Errorf("get rate limit policy: %w", err)
	}
	defer rows.Close()
	items, err := scanRateLimitPolicies(rows)
	if err != nil {
		return rateLimitPolicy{}, err
	}
	if len(items) == 0 {
		return rateLimitPolicy{}, sql.ErrNoRows
	}
	return items[0], nil
}
