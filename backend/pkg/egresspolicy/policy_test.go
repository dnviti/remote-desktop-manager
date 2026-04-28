package egresspolicy

import (
	"context"
	"encoding/json"
	"net"
	"testing"
)

type staticResolver map[string][]net.IPAddr

func (r staticResolver) LookupIPAddr(_ context.Context, host string) ([]net.IPAddr, error) {
	if values, ok := r[host]; ok {
		return values, nil
	}
	return nil, &net.DNSError{Err: "not found", Name: host}
}

func TestAuthorizeEmptyPolicyDenies(t *testing.T) {
	decision := Authorize(context.Background(), Empty(), Request{Protocol: "SSH", Host: "10.0.0.5", Port: 22}, testOptions())
	if decision.Allowed {
		t.Fatal("empty policy allowed egress")
	}
}

func TestAuthorizeExactHostname(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["SSH"],"hosts":["target.internal"],"ports":[22]}]}`)
	decision := Authorize(context.Background(), policy, Request{Protocol: "ssh", Host: "target.internal", Port: 22}, testOptions())
	if !decision.Allowed {
		t.Fatalf("expected allow, got %q", decision.Reason)
	}
}

func TestAuthorizeWildcardHostname(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["RDP"],"hosts":["*.corp.example"],"ports":[3389]}]}`)
	decision := Authorize(context.Background(), policy, Request{Protocol: "RDP", Host: "desk.corp.example", Port: 3389}, testOptions())
	if !decision.Allowed {
		t.Fatalf("expected allow, got %q", decision.Reason)
	}
	denied := Authorize(context.Background(), policy, Request{Protocol: "RDP", Host: "corp.example", Port: 3389}, testOptions())
	if denied.Allowed {
		t.Fatal("wildcard matched bare domain")
	}
}

func TestAuthorizeCIDR(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["DATABASE"],"cidrs":["10.10.0.0/16"],"ports":[5432]}]}`)
	decision := Authorize(context.Background(), policy, Request{Protocol: "DATABASE", Host: "10.10.2.15", Port: 5432}, testOptions())
	if !decision.Allowed {
		t.Fatalf("expected allow, got %q", decision.Reason)
	}
}

func TestAuthorizeMixedDestinationRuleMatchesHostOrCIDR(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["SSH"],"hosts":["target.internal"],"cidrs":["10.10.0.0/16"],"ports":[22]}]}`)

	hostDecision := Authorize(context.Background(), policy, Request{Protocol: "SSH", Host: "target.internal", Port: 22}, testOptions())
	if !hostDecision.Allowed {
		t.Fatalf("expected host allow, got %q", hostDecision.Reason)
	}

	cidrDecision := Authorize(context.Background(), policy, Request{Protocol: "SSH", Host: "10.10.2.15", Port: 22}, testOptions())
	if !cidrDecision.Allowed {
		t.Fatalf("expected CIDR allow, got %q", cidrDecision.Reason)
	}
}

func TestAuthorizeMismatchedPortDenies(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["SSH"],"cidrs":["10.0.0.0/8"],"ports":[22]}]}`)
	decision := Authorize(context.Background(), policy, Request{Protocol: "SSH", Host: "10.2.3.4", Port: 2222}, testOptions())
	if decision.Allowed {
		t.Fatal("mismatched port allowed egress")
	}
}

func TestAuthorizeFirstMatchingActionWins(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[
		{"description":"block prod","action":"DISALLOW","protocols":["SSH"],"hosts":["target.internal"],"ports":[22]},
		{"description":"allow prod","action":"ALLOW","protocols":["SSH"],"hosts":["target.internal"],"ports":[22]}
	]}`)
	decision := Authorize(context.Background(), policy, Request{Protocol: "SSH", Host: "target.internal", Port: 22}, testOptions())
	if decision.Allowed {
		t.Fatal("expected first disallow rule to block egress")
	}
	if decision.RuleIndex != 1 || decision.RuleAction != ActionDisallow || decision.Rule != "block prod" {
		t.Fatalf("unexpected decision metadata %#v", decision)
	}
}

func TestAuthorizeScopedRules(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[
		{"description":"team database","action":"ALLOW","teamIds":["22222222-2222-4222-8222-222222222222"],"protocols":["DATABASE"],"cidrs":["10.10.0.0/16"],"ports":[5432]},
		{"description":"user ssh","action":"ALLOW","userIds":["11111111-1111-4111-8111-111111111111"],"protocols":["SSH"],"hosts":["target.internal"],"ports":[22]}
	]}`)

	teamDecision := Authorize(context.Background(), policy, Request{
		Protocol: "DATABASE",
		Host:     "10.10.2.15",
		Port:     5432,
		UserID:   "33333333-3333-4333-8333-333333333333",
		TeamIDs:  []string{"22222222-2222-4222-8222-222222222222"},
	}, testOptions())
	if !teamDecision.Allowed || teamDecision.RuleIndex != 1 {
		t.Fatalf("expected team scoped allow, got %#v", teamDecision)
	}

	userDecision := Authorize(context.Background(), policy, Request{
		Protocol: "SSH",
		Host:     "target.internal",
		Port:     22,
		UserID:   "11111111-1111-4111-8111-111111111111",
	}, testOptions())
	if !userDecision.Allowed || userDecision.RuleIndex != 2 {
		t.Fatalf("expected user scoped allow, got %#v", userDecision)
	}

	denied := Authorize(context.Background(), policy, Request{
		Protocol: "SSH",
		Host:     "target.internal",
		Port:     22,
		UserID:   "33333333-3333-4333-8333-333333333333",
	}, testOptions())
	if denied.Allowed || !denied.DefaultDeny {
		t.Fatalf("expected unmatched scoped rule to default deny, got %#v", denied)
	}
}

func TestAuthorizeForbiddenAddressDenies(t *testing.T) {
	policy := mustPolicy(t, `{"rules":[{"protocols":["SSH"],"hosts":["target.internal"],"ports":[22]}]}`)
	opts := testOptions()
	opts.Resolver = staticResolver{"target.internal": {{IP: net.ParseIP("127.0.0.1")}}}
	decision := Authorize(context.Background(), policy, Request{Protocol: "SSH", Host: "target.internal", Port: 22}, opts)
	if decision.Allowed {
		t.Fatal("loopback target allowed egress")
	}
}

func TestNormalizeRejectsInvalidPolicy(t *testing.T) {
	if _, _, err := NormalizeRaw(json.RawMessage(`{"rules":[{"protocols":["SSH"],"hosts":["*"],"ports":[22]}]}`)); err == nil {
		t.Fatal("expected bare wildcard rejection")
	}
	if _, _, err := NormalizeRaw(json.RawMessage(`{"rules":[{"protocols":["SSH"],"cidrs":["bad"],"ports":[22]}]}`)); err == nil {
		t.Fatal("expected CIDR rejection")
	}
}

func TestNormalizeDisabledRuleCanBeIncomplete(t *testing.T) {
	raw, policy, err := NormalizeRaw(json.RawMessage(`{"rules":[{"enabled":false,"hosts":["*"],"notes":"draft"}]}`))
	if err != nil {
		t.Fatalf("NormalizeRaw() error: %v", err)
	}
	if len(policy.Rules) != 1 || ruleEnabled(policy.Rules[0]) {
		t.Fatalf("expected one disabled rule, got %#v", policy.Rules)
	}
	if string(raw) != `{"rules":[{"enabled":false,"hosts":["*"],"notes":"draft"}]}` {
		t.Fatalf("unexpected normalized disabled rule %s", raw)
	}
}

func TestRequiresPrincipalRawDetectsScopedEnabledRules(t *testing.T) {
	if !RequiresPrincipalRaw(json.RawMessage(`{"rules":[{"userIds":["11111111-1111-4111-8111-111111111111"],"protocols":["SSH"],"hosts":["target.internal"],"ports":[22]}]}`)) {
		t.Fatal("expected scoped enabled rule to require principal context")
	}
	if RequiresPrincipalRaw(json.RawMessage(`{"rules":[{"enabled":false,"userIds":["not-a-uuid"]}]}`)) {
		t.Fatal("disabled draft rule should not require principal context")
	}
}

func mustPolicy(t *testing.T, raw string) Policy {
	t.Helper()
	_, policy, err := NormalizeRaw(json.RawMessage(raw))
	if err != nil {
		t.Fatalf("NormalizeRaw() error: %v", err)
	}
	return policy
}

func testOptions() Options {
	return Options{
		AllowLocalNetwork: true,
		AllowLoopback:     false,
		LocalAddrs:        map[string]struct{}{},
		Resolver: staticResolver{
			"target.internal":   {{IP: net.ParseIP("10.0.0.5")}},
			"desk.corp.example": {{IP: net.ParseIP("10.0.0.6")}},
			"corp.example":      {{IP: net.ParseIP("10.0.0.7")}},
		},
	}
}
