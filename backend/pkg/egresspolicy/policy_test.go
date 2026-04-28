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
