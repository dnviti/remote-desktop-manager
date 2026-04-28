package gateways

import (
	"encoding/json"
	"testing"
)

func TestPrepareGatewayEgressPolicyDefaultsToDeny(t *testing.T) {
	raw, err := prepareGatewayEgressPolicy(nil)
	if err != nil {
		t.Fatalf("prepareGatewayEgressPolicy returned error: %v", err)
	}
	if string(raw) != `{"rules":[]}` {
		t.Fatalf("unexpected default policy %s", raw)
	}
}

func TestPrepareGatewayEgressPolicyRejectsInvalidCIDR(t *testing.T) {
	_, err := prepareGatewayEgressPolicy(json.RawMessage(`{"rules":[{"protocols":["SSH"],"cidrs":["not-a-cidr"],"ports":[22]}]}`))
	if err == nil {
		t.Fatal("expected invalid CIDR rejection")
	}
}

func TestChangedGatewayFieldsIncludesEgressPolicy(t *testing.T) {
	var input updatePayload
	if err := input.EgressPolicy.UnmarshalJSON([]byte(`{"rules":[]}`)); err != nil {
		t.Fatalf("unmarshal egress policy: %v", err)
	}
	fields := changedGatewayFields(input)
	if len(fields) != 1 || fields[0] != "egressPolicy" {
		t.Fatalf("unexpected changed fields %#v", fields)
	}
}
