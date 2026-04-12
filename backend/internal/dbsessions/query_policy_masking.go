package dbsessions

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"math"
	"strings"
)

func (s Service) loadMaskingPolicies(ctx context.Context, tenantID string) []maskingPolicyRecord {
	return s.loadMaskingPoliciesWithSettings(ctx, tenantID, databaseSettings{})
}

func (s Service) loadMaskingPoliciesWithSettings(ctx context.Context, tenantID string, settings databaseSettings) []maskingPolicyRecord {
	if !settingBoolOrDefault(settings.MaskingEnabled, true) {
		return nil
	}
	return resolveMaskingPolicies(s.loadTenantMaskingPolicies(ctx, tenantID), settings)
}

func (s Service) loadTenantMaskingPolicies(ctx context.Context, tenantID string) []maskingPolicyRecord {
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
