package main

import (
	"net/http"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/publicconfig"
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
)

func TestRegisterFeatureGatedRoutes(t *testing.T) {
	deps := &apiDependencies{
		authenticator:       &authn.Authenticator{},
		publicConfigService: publicconfig.Service{Features: runtimefeatures.Manifest{}},
		features: runtimefeatures.Manifest{
			ConnectionsEnabled:      false,
			DatabaseProxyEnabled:    false,
			KeychainEnabled:         false,
			RecordingsEnabled:       false,
			ZeroTrustEnabled:        false,
			AgenticAIEnabled:        false,
			EnterpriseAuthEnabled:   false,
			SharingApprovalsEnabled: false,
			CLIEnabled:              false,
		},
	}
	mux := http.NewServeMux()
	deps.register(mux)

	expectRouteAbsent(t, mux, "GET", "/api/secrets")
	expectRouteAbsent(t, mux, "GET", "/api/recordings")
	expectRouteAbsent(t, mux, "GET", "/api/gateways")
	expectRouteAbsent(t, mux, "POST", "/api/cli/auth/device")
	expectRoutePresent(t, mux, "GET", "/api/auth/config")
	expectRoutePresent(t, mux, "GET", "/api/setup/status")
}

func expectRouteAbsent(t *testing.T, mux *http.ServeMux, method, path string) {
	t.Helper()
	req, err := http.NewRequest(method, path, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	_, pattern := mux.Handler(req)
	if pattern != "" && pattern != "/" {
		t.Fatalf("expected %s %s to be absent, matched pattern %q", method, path, pattern)
	}
}

func expectRoutePresent(t *testing.T, mux *http.ServeMux, method, path string) {
	t.Helper()
	req, err := http.NewRequest(method, path, nil)
	if err != nil {
		t.Fatalf("build request: %v", err)
	}
	_, pattern := mux.Handler(req)
	if pattern == "" || pattern == "/" {
		t.Fatalf("expected %s %s to be present", method, path)
	}
}
