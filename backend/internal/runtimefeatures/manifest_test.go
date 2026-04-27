package runtimefeatures

import "testing"

func TestFromEnvDefaultsAndOverrides(t *testing.T) {
	t.Setenv("FEATURE_CONNECTIONS_ENABLED", "false")
	t.Setenv("FEATURE_DATABASE_PROXY_ENABLED", "true")
	t.Setenv("FEATURE_IP_GEOLOCATION_ENABLED", "false")
	t.Setenv("FEATURE_KEYCHAIN_ENABLED", "false")
	t.Setenv("FEATURE_MULTI_TENANCY_ENABLED", "false")
	t.Setenv("FEATURE_RECORDINGS_ENABLED", "false")
	t.Setenv("FEATURE_ZERO_TRUST_ENABLED", "true")
	t.Setenv("FEATURE_AGENTIC_AI_ENABLED", "false")
	t.Setenv("FEATURE_ENTERPRISE_AUTH_ENABLED", "false")
	t.Setenv("FEATURE_SHARING_APPROVALS_ENABLED", "true")
	t.Setenv("CLI_ENABLED", "true")
	t.Setenv("ARSENALE_INSTALL_MODE", "development")
	t.Setenv("ARSENALE_INSTALL_BACKEND", "kubernetes")
	t.Setenv("ARSENALE_DIRECT_ROUTING_ENABLED", "false")
	t.Setenv("ARSENALE_ZERO_TRUST_ENABLED", "true")

	manifest := FromEnv()
	if manifest.Mode != "development" {
		t.Fatalf("expected development mode, got %q", manifest.Mode)
	}
	if manifest.Backend != "kubernetes" {
		t.Fatalf("expected kubernetes backend, got %q", manifest.Backend)
	}
	if manifest.ConnectionsEnabled {
		t.Fatal("expected connections to be disabled")
	}
	if !manifest.DatabaseProxyEnabled {
		t.Fatal("expected database proxy to remain enabled")
	}
	if manifest.IPGeolocationEnabled {
		t.Fatal("expected IP geolocation to be disabled")
	}
	if manifest.KeychainEnabled {
		t.Fatal("expected keychain to be disabled")
	}
	if manifest.MultiTenancyEnabled {
		t.Fatal("expected multi-tenancy to be disabled")
	}
	if manifest.RecordingsEnabled {
		t.Fatal("expected recordings to be disabled")
	}
	if !manifest.ZeroTrustEnabled || manifest.Routing.DirectGateway {
		t.Fatal("expected zero trust enabled with direct routing disabled")
	}
	if manifest.AgenticAIEnabled || manifest.EnterpriseAuthEnabled {
		t.Fatal("expected AI and enterprise auth to be disabled")
	}
	if !manifest.SharingApprovalsEnabled || !manifest.CLIEnabled {
		t.Fatal("expected sharing approvals and CLI to be enabled")
	}
	if !manifest.HasFeature(FeatureDatabases) || manifest.HasFeature(FeatureConnections) {
		t.Fatal("expected feature lookup to follow resolved booleans")
	}
	wantCapabilities := []Feature{
		FeatureDatabases,
		FeatureZeroTrust,
		FeatureSharingApprovals,
		FeatureCLI,
	}
	if got := manifest.EnabledCapabilities; !sameFeatures(got, wantCapabilities) {
		t.Fatalf("enabled capabilities mismatch: got %#v want %#v", got, wantCapabilities)
	}
}

func sameFeatures(a, b []Feature) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
