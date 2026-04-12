package dbsessions

import (
	"context"
	"database/sql"
	"strings"
	"testing"
)

func TestResolveFirewallRulesModes(t *testing.T) {
	tenantRules := []firewallRuleRecord{
		{Name: "Tenant low", Pattern: "tenant_low", Action: "BLOCK", Priority: 10},
		{Name: "Tenant high", Pattern: "tenant_high", Action: "BLOCK", Priority: 80},
	}
	connectionEnabled := true
	connectionRules := []databaseFirewallRuleSettings{
		{Name: "Connection top", Pattern: "conn_top", Action: "ALERT", Priority: 100, Enabled: &connectionEnabled},
		{Name: "Connection mid", Pattern: "conn_mid", Action: "BLOCK", Priority: 50},
	}

	if got := resolveFirewallRules(tenantRules, databaseSettings{FirewallPolicyMode: "inherit", FirewallRules: connectionRules}); len(got) != 2 || got[0].Name != "Tenant low" || got[1].Name != "Tenant high" {
		t.Fatalf("inherit mode returned %+v", got)
	}

	merged := resolveFirewallRules(tenantRules, databaseSettings{FirewallPolicyMode: "merge", FirewallRules: connectionRules})
	if len(merged) != 4 {
		t.Fatalf("merge mode returned %d rules, want 4", len(merged))
	}
	if merged[0].Name != "Connection top" || merged[1].Name != "Tenant high" || merged[2].Name != "Connection mid" {
		t.Fatalf("merge mode order = %#v", merged)
	}

	override := resolveFirewallRules(tenantRules, databaseSettings{FirewallPolicyMode: "override", FirewallRules: connectionRules})
	if len(override) != 2 || override[0].Name != "Connection top" || override[1].Name != "Connection mid" {
		t.Fatalf("override mode returned %#v", override)
	}
}

func TestLoadMaskingPoliciesWithSettingsUsesConnectionOverridesWithoutDB(t *testing.T) {
	service := Service{}
	settings := databaseSettings{
		MaskingPolicyMode: "override",
		MaskingPolicies: []databaseMaskingPolicySettings{
			{Name: "Local email", ColumnPattern: "email", Strategy: "PARTIAL"},
		},
	}

	policies := service.loadMaskingPoliciesWithSettings(context.Background(), "", settings)
	if len(policies) != 1 {
		t.Fatalf("loadMaskingPoliciesWithSettings() returned %d policies, want 1", len(policies))
	}
	if policies[0].Name != "Local email" || policies[0].Strategy != "PARTIAL" {
		t.Fatalf("unexpected masking policy: %#v", policies[0])
	}
}

func TestEvaluateFirewallWithSettingsUsesConnectionRulesWithoutDB(t *testing.T) {
	service := Service{}
	settings := databaseSettings{
		FirewallPolicyMode: "override",
		FirewallRules: []databaseFirewallRuleSettings{
			{Name: "Blocked probe", Pattern: "blocked_probe", Action: "BLOCK"},
		},
	}

	result := service.evaluateFirewallWithSettings(context.Background(), "", settings, "select 1 as blocked_probe", "", "")
	if result.Allowed {
		t.Fatalf("evaluateFirewallWithSettings() allowed query, want blocked result: %#v", result)
	}
	if result.RuleName != "Blocked probe" {
		t.Fatalf("evaluateFirewallWithSettings() rule = %q, want Blocked probe", result.RuleName)
	}
}

func TestResolveRateLimitPoliciesNamespacesConnectionPolicies(t *testing.T) {
	tenantPolicies := []rateLimitPolicyRecord{
		{ID: "tenant-policy", Name: "Tenant", Priority: 10},
	}
	settings := databaseSettings{
		RateLimitPolicyMode: "merge",
		RateLimitPolicies: []databaseRateLimitPolicySettings{
			{ID: "local-limit", Name: "Local", WindowMS: 1000, MaxQueries: 5, BurstMax: 2, Priority: 50},
		},
	}

	policies := resolveRateLimitPolicies(tenantPolicies, "conn-123", settings)
	if len(policies) != 2 {
		t.Fatalf("resolveRateLimitPolicies() returned %d policies, want 2", len(policies))
	}
	if policies[0].Name != "Local" || !strings.HasPrefix(policies[0].ID, "conn:conn-123:local-limit") {
		t.Fatalf("unexpected connection policy %#v", policies[0])
	}
	if policies[1].ID != "tenant-policy" {
		t.Fatalf("tenant policy id = %q, want tenant-policy", policies[1].ID)
	}
}

func TestEvaluateRateLimitWithSettingsUsesConnectionPoliciesWithoutDB(t *testing.T) {
	service := Service{}
	connectionEnabled := true

	dbRateLimitBucketsMu.Lock()
	dbRateLimitBuckets = map[string]*tokenBucket{}
	dbRateLimitBucketsMu.Unlock()

	settings := databaseSettings{
		RateLimitPolicyMode: "override",
		RateLimitPolicies: []databaseRateLimitPolicySettings{
			{
				ID:         "local",
				Name:       "Local throttle",
				QueryType:  string(dbQueryTypeSelect),
				WindowMS:   60000,
				MaxQueries: 1,
				BurstMax:   1,
				Action:     "REJECT",
				Enabled:    &connectionEnabled,
			},
		},
	}

	first := service.evaluateRateLimitWithSettings(context.Background(), "user-1", "tenant-1", "conn-1", settings, dbQueryTypeSelect, "OPERATOR", "", "")
	if !first.Allowed || !first.Matched {
		t.Fatalf("first evaluation = %#v, want allowed matched result", first)
	}

	second := service.evaluateRateLimitWithSettings(context.Background(), "user-1", "tenant-1", "conn-1", settings, dbQueryTypeSelect, "OPERATOR", "", "")
	if second.Allowed {
		t.Fatalf("second evaluation = %#v, want blocked result", second)
	}
	if second.PolicyName != "Local throttle" {
		t.Fatalf("second policy = %q, want Local throttle", second.PolicyName)
	}
}

func TestResolveMaskingPoliciesMergePrefersConnectionPolicies(t *testing.T) {
	tenantPolicies := []maskingPolicyRecord{
		{Name: "Tenant email", ColumnPattern: "email", Strategy: "REDACT", Scope: sql.NullString{}},
	}
	settings := databaseSettings{
		MaskingPolicyMode: "merge",
		MaskingPolicies: []databaseMaskingPolicySettings{
			{Name: "Connection email", ColumnPattern: "email", Strategy: "HASH"},
		},
	}

	policies := resolveMaskingPolicies(tenantPolicies, settings)
	masked := findMaskedColumns(policies, []string{"email"}, "", "", "")
	if len(masked) != 1 {
		t.Fatalf("findMaskedColumns() returned %d columns, want 1", len(masked))
	}
	if masked[0].PolicyName != "Connection email" || masked[0].Strategy != "HASH" {
		t.Fatalf("masked column = %#v", masked[0])
	}
}
