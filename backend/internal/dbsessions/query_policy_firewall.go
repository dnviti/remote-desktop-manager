package dbsessions

import (
	"context"
	"strings"
)

func (s Service) evaluateFirewall(ctx context.Context, tenantID, queryText, database, table string) firewallEvaluation {
	return s.evaluateFirewallWithSettings(ctx, tenantID, databaseSettings{}, queryText, database, table)
}

func (s Service) evaluateFirewallWithSettings(ctx context.Context, tenantID string, settings databaseSettings, queryText, database, table string) firewallEvaluation {
	if !settingBoolOrDefault(settings.FirewallEnabled, true) {
		return firewallEvaluation{Allowed: true}
	}

	rules := resolveFirewallRules(s.loadTenantFirewallRules(ctx, tenantID), settings)
	for _, rule := range rules {
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

func (s Service) loadTenantFirewallRules(ctx context.Context, tenantID string) []firewallRuleRecord {
	if s.DB == nil || strings.TrimSpace(tenantID) == "" {
		return nil
	}

	rows, err := s.DB.Query(ctx, `
SELECT name, pattern, action::text, scope, priority
FROM "DbFirewallRule"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	rules := make([]firewallRuleRecord, 0)
	for rows.Next() {
		var rule firewallRuleRecord
		if scanErr := rows.Scan(&rule.Name, &rule.Pattern, &rule.Action, &rule.Scope, &rule.Priority); scanErr != nil {
			return nil
		}
		rules = append(rules, rule)
	}
	return rules
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
