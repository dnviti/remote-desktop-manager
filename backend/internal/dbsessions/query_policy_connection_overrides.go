package dbsessions

import (
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

type connectionPolicyMode string

const (
	connectionPolicyModeInherit  connectionPolicyMode = "inherit"
	connectionPolicyModeMerge    connectionPolicyMode = "merge"
	connectionPolicyModeOverride connectionPolicyMode = "override"
)

func normalizeConnectionPolicyMode(value string) connectionPolicyMode {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case string(connectionPolicyModeMerge):
		return connectionPolicyModeMerge
	case string(connectionPolicyModeOverride):
		return connectionPolicyModeOverride
	default:
		return connectionPolicyModeInherit
	}
}

func resolveFirewallRules(tenantRules []firewallRuleRecord, settings databaseSettings) []firewallRuleRecord {
	connectionRules := buildConnectionFirewallRules(settings.FirewallRules)

	switch normalizeConnectionPolicyMode(settings.FirewallPolicyMode) {
	case connectionPolicyModeOverride:
		return sortFirewallRules(connectionRules)
	case connectionPolicyModeMerge:
		return sortFirewallRules(append(connectionRules, tenantRules...))
	default:
		return tenantRules
	}
}

func buildConnectionFirewallRules(items []databaseFirewallRuleSettings) []firewallRuleRecord {
	rules := make([]firewallRuleRecord, 0, len(items))
	for _, item := range items {
		if !settingBoolOrDefault(item.Enabled, true) {
			continue
		}

		name := strings.TrimSpace(item.Name)
		pattern := strings.TrimSpace(item.Pattern)
		if name == "" || pattern == "" {
			continue
		}

		action := strings.ToUpper(strings.TrimSpace(item.Action))
		if action == "" {
			action = "BLOCK"
		}

		scope := strings.TrimSpace(item.Scope)
		rules = append(rules, firewallRuleRecord{
			Name:     name,
			Pattern:  pattern,
			Action:   action,
			Scope:    sql.NullString{String: scope, Valid: scope != ""},
			Priority: item.Priority,
		})
	}
	return rules
}

func sortFirewallRules(items []firewallRuleRecord) []firewallRuleRecord {
	if len(items) < 2 {
		return items
	}

	sorted := append([]firewallRuleRecord(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Priority > sorted[j].Priority
	})
	return sorted
}

func resolveMaskingPolicies(tenantPolicies []maskingPolicyRecord, settings databaseSettings) []maskingPolicyRecord {
	connectionPolicies := buildConnectionMaskingPolicies(settings.MaskingPolicies)

	switch normalizeConnectionPolicyMode(settings.MaskingPolicyMode) {
	case connectionPolicyModeOverride:
		return connectionPolicies
	case connectionPolicyModeMerge:
		return append(connectionPolicies, tenantPolicies...)
	default:
		return tenantPolicies
	}
}

func buildConnectionMaskingPolicies(items []databaseMaskingPolicySettings) []maskingPolicyRecord {
	policies := make([]maskingPolicyRecord, 0, len(items))
	for _, item := range items {
		if !settingBoolOrDefault(item.Enabled, true) {
			continue
		}

		name := strings.TrimSpace(item.Name)
		columnPattern := strings.TrimSpace(item.ColumnPattern)
		if name == "" || columnPattern == "" {
			continue
		}

		strategy := strings.ToUpper(strings.TrimSpace(item.Strategy))
		if strategy == "" {
			strategy = "REDACT"
		}

		scope := strings.TrimSpace(item.Scope)
		policies = append(policies, maskingPolicyRecord{
			Name:          name,
			ColumnPattern: columnPattern,
			Strategy:      strategy,
			ExemptRoles:   item.ExemptRoles,
			Scope:         sql.NullString{String: scope, Valid: scope != ""},
		})
	}
	return policies
}

func resolveRateLimitPolicies(tenantPolicies []rateLimitPolicyRecord, connectionID string, settings databaseSettings) []rateLimitPolicyRecord {
	connectionPolicies := buildConnectionRateLimitPolicies(connectionID, settings.RateLimitPolicies)

	switch normalizeConnectionPolicyMode(settings.RateLimitPolicyMode) {
	case connectionPolicyModeOverride:
		return sortRateLimitPolicies(connectionPolicies)
	case connectionPolicyModeMerge:
		return sortRateLimitPolicies(append(connectionPolicies, tenantPolicies...))
	default:
		return tenantPolicies
	}
}

func buildConnectionRateLimitPolicies(connectionID string, items []databaseRateLimitPolicySettings) []rateLimitPolicyRecord {
	policies := make([]rateLimitPolicyRecord, 0, len(items))
	connectionKey := strings.TrimSpace(connectionID)
	if connectionKey == "" {
		connectionKey = "unknown-connection"
	}

	for index, item := range items {
		if !settingBoolOrDefault(item.Enabled, true) {
			continue
		}

		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}

		windowMS := item.WindowMS
		if windowMS <= 0 {
			windowMS = 60000
		}
		maxQueries := item.MaxQueries
		if maxQueries <= 0 {
			maxQueries = 100
		}
		burstMax := item.BurstMax
		if burstMax <= 0 {
			burstMax = maxQueries
		}

		queryType := strings.ToUpper(strings.TrimSpace(item.QueryType))
		scope := strings.TrimSpace(item.Scope)
		action := strings.ToUpper(strings.TrimSpace(item.Action))
		if action == "" {
			action = "REJECT"
		}

		localID := strings.TrimSpace(item.ID)
		if localID == "" {
			localID = fmt.Sprintf("policy-%d", index)
		}

		policies = append(policies, rateLimitPolicyRecord{
			ID:          fmt.Sprintf("conn:%s:%s", connectionKey, localID),
			Name:        name,
			QueryType:   sql.NullString{String: queryType, Valid: queryType != ""},
			WindowMS:    windowMS,
			MaxQueries:  maxQueries,
			BurstMax:    burstMax,
			ExemptRoles: item.ExemptRoles,
			Scope:       sql.NullString{String: scope, Valid: scope != ""},
			Action:      action,
			Priority:    item.Priority,
		})
	}
	return policies
}

func sortRateLimitPolicies(items []rateLimitPolicyRecord) []rateLimitPolicyRecord {
	if len(items) < 2 {
		return items
	}

	sorted := append([]rateLimitPolicyRecord(nil), items...)
	sort.SliceStable(sorted, func(i, j int) bool {
		return sorted[i].Priority > sorted[j].Priority
	})
	return sorted
}
