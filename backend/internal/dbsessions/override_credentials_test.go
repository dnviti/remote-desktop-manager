package dbsessions

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestStoreAndResolveOverrideCredentials(t *testing.T) {
	key := []byte("0123456789abcdef0123456789abcdef")
	metadata := map[string]any{"username": "manual-user"}

	if err := storeOverridePasswordMetadata(metadata, "ManualPass123!", key); err != nil {
		t.Fatalf("storeOverridePasswordMetadata() error = %v", err)
	}

	raw, _ := json.Marshal(metadata)
	if strings.Contains(string(raw), "ManualPass123!") {
		t.Fatalf("metadata unexpectedly contains plaintext password: %s", string(raw))
	}

	username, password, err := resolveOverrideCredentials(metadata, key)
	if err != nil {
		t.Fatalf("resolveOverrideCredentials() error = %v", err)
	}
	if username != "manual-user" {
		t.Fatalf("username = %q, want %q", username, "manual-user")
	}
	if password != "ManualPass123!" {
		t.Fatalf("password = %q, want %q", password, "ManualPass123!")
	}
}

func TestShouldUseOwnedDatabaseSessionRuntimeAllowsOverrideCredentials(t *testing.T) {
	if !shouldUseOwnedDatabaseSessionRuntime("postgresql", true) {
		t.Fatal("shouldUseOwnedDatabaseSessionRuntime() = false, want true for PostgreSQL override credentials")
	}
}

func TestShouldUseOwnedDatabaseSessionRuntimeAllowsPostgresByDefault(t *testing.T) {
	t.Setenv("GO_QUERY_RUNNER_ENABLED", "")
	if !shouldUseOwnedDatabaseSessionRuntime("postgresql", false) {
		t.Fatal("shouldUseOwnedDatabaseSessionRuntime() = false, want true for PostgreSQL by default")
	}
}

func TestShouldUseOwnedDatabaseSessionRuntimeHonorsExplicitDisable(t *testing.T) {
	t.Setenv("GO_QUERY_RUNNER_ENABLED", "false")
	if shouldUseOwnedDatabaseSessionRuntime("postgresql", true) {
		t.Fatal("shouldUseOwnedDatabaseSessionRuntime() = true, want false when explicitly disabled")
	}
}

func TestShouldCaptureExecutionPlan(t *testing.T) {
	testCases := []struct {
		name     string
		enabled  bool
		protocol string
		want     bool
	}{
		{name: "postgres", enabled: true, protocol: "postgresql", want: true},
		{name: "mysql", enabled: true, protocol: "mysql", want: true},
		{name: "mariadb alias", enabled: true, protocol: "mariadb", want: true},
		{name: "disabled postgres", enabled: false, protocol: "postgresql", want: false},
		{name: "mongodb", enabled: true, protocol: "mongodb", want: false},
		{name: "oracle", enabled: true, protocol: "oracle", want: false},
		{name: "mssql", enabled: true, protocol: "mssql", want: false},
	}

	for _, tc := range testCases {
		t.Run(tc.name, func(t *testing.T) {
			got := tc.enabled && supportsStoredExecutionPlan(tc.protocol)
			if got != tc.want {
				t.Fatalf("enabled=%v supportsStoredExecutionPlan(%q) = %v, want %v", tc.enabled, tc.protocol, got, tc.want)
			}
		})
	}
}

func TestParseDatabaseSettingsPersistExecutionPlan(t *testing.T) {
	settings := parseDatabaseSettings([]byte(`{"protocol":"postgresql","databaseName":"arsenale_demo","persistExecutionPlan":true}`))
	if !settings.PersistExecutionPlan {
		t.Fatal("parseDatabaseSettings() did not retain persistExecutionPlan")
	}
}

func TestParseDatabaseSettingsRetainsSSLMode(t *testing.T) {
	settings := parseDatabaseSettings([]byte(`{"protocol":"mysql","sslMode":"require"}`))
	if settings.SSLMode != "require" {
		t.Fatalf("parseDatabaseSettings() sslMode = %q, want %q", settings.SSLMode, "require")
	}
}

func TestWriteOwnedQueryErrorUnsupported(t *testing.T) {
	recorder := httptest.NewRecorder()
	writeOwnedQueryError(recorder, ErrQueryRuntimeUnsupported)
	if recorder.Code != http.StatusNotImplemented {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusNotImplemented)
	}
	if !strings.Contains(recorder.Body.String(), "unsupported") {
		t.Fatalf("body = %q, want unsupported error message", recorder.Body.String())
	}
}
