package connections

import "testing"

func TestCompatibleGatewayTypesForDatabaseConnections(t *testing.T) {
	t.Run("database connections use db proxy gateways", func(t *testing.T) {
		got := compatibleGatewayTypes("DATABASE")
		if len(got) != 1 || got[0] != "DB_PROXY" {
			t.Fatalf("expected DATABASE to require DB_PROXY, got %#v", got)
		}
	})

	t.Run("db tunnel connections use ssh gateways", func(t *testing.T) {
		got := compatibleGatewayTypes("DB_TUNNEL")
		if len(got) != 2 || got[0] != "MANAGED_SSH" || got[1] != "SSH_BASTION" {
			t.Fatalf("expected DB_TUNNEL to require SSH gateways, got %#v", got)
		}
	})
}

func TestFriendlyGatewayRequirementForDatabaseConnections(t *testing.T) {
	if got := friendlyGatewayRequirement("DATABASE"); got != "DB_PROXY" {
		t.Fatalf("expected DATABASE gateway hint to be DB_PROXY, got %q", got)
	}
	if got := friendlyGatewayRequirement("DB_TUNNEL"); got != "SSH_BASTION or MANAGED_SSH" {
		t.Fatalf("expected DB_TUNNEL gateway hint to mention SSH gateways, got %q", got)
	}
}
