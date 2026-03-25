package adapters

import (
	"sort"
	"testing"
)

func TestNewRegistry(t *testing.T) {
	r := NewRegistry()
	if r == nil {
		t.Fatal("NewRegistry returned nil")
	}
}

func TestRegistryGet_RegisteredAdapters(t *testing.T) {
	r := NewRegistry()

	tests := []struct {
		protocol    string
		defaultPort int
	}{
		{"oracle", 1521},
		{"mssql", 1433},
		{"db2", 50000},
	}

	for _, tt := range tests {
		t.Run(tt.protocol, func(t *testing.T) {
			a := r.Get(tt.protocol)
			if a == nil {
				t.Fatalf("Get(%q) returned nil", tt.protocol)
			}
			if got := a.Protocol(); got != tt.protocol {
				t.Errorf("Protocol() = %q, want %q", got, tt.protocol)
			}
			if got := a.DefaultPort(); got != tt.defaultPort {
				t.Errorf("DefaultPort() = %d, want %d", got, tt.defaultPort)
			}
		})
	}
}

func TestRegistryGet_UnregisteredProtocol(t *testing.T) {
	r := NewRegistry()

	unregistered := []string{"postgres", "mysql", "redis", "mongodb", ""}
	for _, proto := range unregistered {
		t.Run(proto, func(t *testing.T) {
			a := r.Get(proto)
			if a != nil {
				t.Errorf("Get(%q) = %v, want nil", proto, a)
			}
		})
	}
}

func TestRegistryProtocols(t *testing.T) {
	r := NewRegistry()
	protocols := r.Protocols()

	if len(protocols) != 3 {
		t.Fatalf("Protocols() returned %d items, want 3", len(protocols))
	}

	sort.Strings(protocols)
	expected := []string{"db2", "mssql", "oracle"}
	for i, p := range protocols {
		if p != expected[i] {
			t.Errorf("Protocols()[%d] = %q, want %q", i, p, expected[i])
		}
	}
}

func TestRegistryHealthCheckAll(t *testing.T) {
	r := NewRegistry()
	results := r.HealthCheckAll()

	if len(results) != 3 {
		t.Fatalf("HealthCheckAll() returned %d results, want 3", len(results))
	}

	for proto, err := range results {
		if err != nil {
			t.Errorf("HealthCheckAll()[%q] = %v, want nil", proto, err)
		}
	}
}

func TestConnectOptions_ExtraMap(t *testing.T) {
	opts := ConnectOptions{
		SessionID:    "test-session",
		Host:         "localhost",
		Port:         1433,
		Username:     "admin",
		Password:     "secret",
		DatabaseName: "testdb",
		Extra: map[string]string{
			"instanceName": "SQLEXPRESS",
			"authMode":     "sql",
		},
	}

	if opts.Extra["instanceName"] != "SQLEXPRESS" {
		t.Errorf("Extra[instanceName] = %q, want %q", opts.Extra["instanceName"], "SQLEXPRESS")
	}
	if opts.Extra["authMode"] != "sql" {
		t.Errorf("Extra[authMode] = %q, want %q", opts.Extra["authMode"], "sql")
	}
}

func TestSessionHandle_Fields(t *testing.T) {
	h := SessionHandle{
		SessionID: "sess-1",
		Protocol:  "mssql",
		LocalAddr: "127.0.0.1:54321",
	}

	if h.SessionID != "sess-1" {
		t.Errorf("SessionID = %q, want %q", h.SessionID, "sess-1")
	}
	if h.Protocol != "mssql" {
		t.Errorf("Protocol = %q, want %q", h.Protocol, "mssql")
	}
	if h.LocalAddr != "127.0.0.1:54321" {
		t.Errorf("LocalAddr = %q, want %q", h.LocalAddr, "127.0.0.1:54321")
	}
}

func TestAdapterInterface_Compliance(t *testing.T) {
	// Verify all adapters implement the Adapter interface at compile time.
	var _ Adapter = (*OracleAdapter)(nil)
	var _ Adapter = (*MSSQLAdapter)(nil)
	var _ Adapter = (*DB2Adapter)(nil)
}
