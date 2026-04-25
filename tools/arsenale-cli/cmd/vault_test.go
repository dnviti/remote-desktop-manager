package cmd

import "testing"

func TestVaultTouchCommandWiring(t *testing.T) {
	if vaultTouchCmd == nil {
		t.Fatal("vaultTouchCmd = nil")
	}
	if vaultTouchCmd.Parent() != vaultCmd {
		t.Fatalf("vaultTouchCmd parent = %v; want vaultCmd", vaultTouchCmd.Parent())
	}
	if got := vaultTouchCmd.Use; got != "touch" {
		t.Fatalf("vaultTouchCmd.Use = %q; want touch", got)
	}
}
