package modelgatewayapi

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/dbsessions"
)

type firewallRuleRecord struct {
	Name        string
	Pattern     string
	Action      string
	Scope       sql.NullString
	Description sql.NullString
	Enabled     bool
	Priority    int
}

type firewallEvaluation struct {
	Allowed   bool
	Action    string
	RuleName  string
	Matched   bool
	RuleScope string
}

type builtinFirewallPattern struct {
	Name    string
	Pattern string
	Action  string
}

var builtinFirewallPatterns = []builtinFirewallPattern{
	{Name: "Drop Table", Pattern: `\bDROP\s+TABLE\b`, Action: "BLOCK"},
	{Name: "Truncate", Pattern: `\bTRUNCATE\b`, Action: "BLOCK"},
	{Name: "Drop Database", Pattern: `\bDROP\s+DATABASE\b`, Action: "BLOCK"},
	{Name: "Bulk SELECT without WHERE", Pattern: `^\s*SELECT\s+\*\s+FROM\s+\S+\s*;?\s*$`, Action: "ALERT"},
}

func (s Service) evaluateFirewall(ctx context.Context, tenantID, queryText, database, table string) (firewallEvaluation, error) {
	if s.DB == nil {
		return firewallEvaluation{}, errors.New("database is unavailable")
	}

	rows, err := s.DB.Query(ctx, `
SELECT name, pattern, action::text, scope, description, enabled, priority
FROM "DbFirewallRule"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return firewallEvaluation{}, fmt.Errorf("list firewall rules: %w", err)
	}
	defer rows.Close()

	var rules []firewallRuleRecord
	for rows.Next() {
		var rule firewallRuleRecord
		if err := rows.Scan(&rule.Name, &rule.Pattern, &rule.Action, &rule.Scope, &rule.Description, &rule.Enabled, &rule.Priority); err != nil {
			return firewallEvaluation{}, fmt.Errorf("scan firewall rule: %w", err)
		}
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		return firewallEvaluation{}, fmt.Errorf("iterate firewall rules: %w", err)
	}

	for _, rule := range rules {
		if matchesFirewallRule(rule.Pattern, rule.Scope.String, queryText, database, table) {
			return firewallEvaluation{
				Allowed:   strings.ToUpper(strings.TrimSpace(rule.Action)) != "BLOCK",
				Action:    strings.ToUpper(strings.TrimSpace(rule.Action)),
				RuleName:  rule.Name,
				Matched:   true,
				RuleScope: rule.Scope.String,
			}, nil
		}
	}

	for _, builtin := range builtinFirewallPatterns {
		re, err := regexp.Compile("(?i)" + builtin.Pattern)
		if err != nil {
			continue
		}
		if re.MatchString(queryText) {
			return firewallEvaluation{
				Allowed:  builtin.Action != "BLOCK",
				Action:   builtin.Action,
				RuleName: "[Built-in] " + builtin.Name,
				Matched:  true,
			}, nil
		}
	}

	return firewallEvaluation{Allowed: true}, nil
}

func (s Service) evaluateFirewallForAIContext(ctx context.Context, tenantID string, aiContext dbsessions.OwnedAIContext, queryText, database, table string) (firewallEvaluation, error) {
	if !boolOrDefault(aiContext.FirewallEnabled, true) {
		return firewallEvaluation{Allowed: true}, nil
	}
	if strings.TrimSpace(database) == "" {
		database = strings.TrimSpace(aiContext.DatabaseName)
	}
	return s.evaluateFirewall(ctx, tenantID, queryText, database, table)
}

func matchesFirewallRule(pattern, scope, queryText, database, table string) bool {
	if trimmed := strings.TrimSpace(scope); trimmed != "" {
		scopeLower := strings.ToLower(trimmed)
		dbMatch := strings.TrimSpace(database) != "" && strings.ToLower(strings.TrimSpace(database)) == scopeLower
		tableMatch := strings.TrimSpace(table) != "" && strings.ToLower(strings.TrimSpace(table)) == scopeLower
		if !dbMatch && !tableMatch {
			return false
		}
	}

	re, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		return false
	}
	return re.MatchString(queryText)
}
