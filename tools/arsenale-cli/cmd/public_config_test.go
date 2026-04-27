package cmd

import (
	"encoding/json"
	"testing"
)

func TestParsePublicConfigIncludesMultiTenancy(t *testing.T) {
	t.Parallel()

	raw, err := json.Marshal(publicConfig{
		Features: publicConfigFeatures{
			EnabledCapabilities:  []publicConfigFeature{publicFeatureConnections, publicFeatureCLI},
			IPGeolocationEnabled: false,
			MultiTenancyEnabled:  false,
			ConnectionsEnabled:   true,
			CLIEnabled:           true,
		},
	})
	if err != nil {
		t.Fatalf("marshal config: %v", err)
	}

	var parsed publicConfig
	if err := json.Unmarshal(raw, &parsed); err != nil {
		t.Fatalf("unmarshal config: %v", err)
	}
	if parsed.Features.MultiTenancyEnabled {
		t.Fatal("expected multi-tenancy to be disabled")
	}
	if parsed.Features.IPGeolocationEnabled {
		t.Fatal("expected IP geolocation to be disabled")
	}
	if !parsed.Features.Enabled(publicFeatureConnections) {
		t.Fatal("expected connections to be enabled")
	}
	if !parsed.Features.Enabled(publicFeatureCLI) {
		t.Fatal("expected CLI to be enabled")
	}
}
