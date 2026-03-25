package tunnel

import (
	"os"
	"testing"
	"time"
)

// setEnvs is a test helper that sets env vars and returns a cleanup function.
func setEnvs(t *testing.T, envs map[string]string) {
	t.Helper()
	for k, v := range envs {
		t.Setenv(k, v)
	}
}

func TestLoadConfigFromEnv_AllRequired(t *testing.T) {
	setEnvs(t, map[string]string{
		"TUNNEL_SERVER_URL": "wss://broker.example.com",
		"TUNNEL_TOKEN":      "deadbeef",
		"TUNNEL_GATEWAY_ID": "gw-42",
	})

	cfg, err := LoadConfigFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if cfg.ServerURL != "wss://broker.example.com" {
		t.Errorf("ServerURL: got %q, want %q", cfg.ServerURL, "wss://broker.example.com")
	}
	if cfg.Token != "deadbeef" {
		t.Errorf("Token: got %q, want %q", cfg.Token, "deadbeef")
	}
	if cfg.GatewayID != "gw-42" {
		t.Errorf("GatewayID: got %q, want %q", cfg.GatewayID, "gw-42")
	}
}

func TestLoadConfigFromEnv_MissingRequired(t *testing.T) {
	tests := []struct {
		name    string
		envs    map[string]string
		wantErr string
	}{
		{
			name:    "missing TUNNEL_SERVER_URL",
			envs:    map[string]string{"TUNNEL_TOKEN": "tok", "TUNNEL_GATEWAY_ID": "gw"},
			wantErr: "TUNNEL_SERVER_URL is required",
		},
		{
			name:    "missing TUNNEL_TOKEN",
			envs:    map[string]string{"TUNNEL_SERVER_URL": "wss://x", "TUNNEL_GATEWAY_ID": "gw"},
			wantErr: "TUNNEL_TOKEN is required",
		},
		{
			name:    "missing TUNNEL_GATEWAY_ID",
			envs:    map[string]string{"TUNNEL_SERVER_URL": "wss://x", "TUNNEL_TOKEN": "tok"},
			wantErr: "TUNNEL_GATEWAY_ID is required",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			// Clear all tunnel env vars first.
			os.Unsetenv("TUNNEL_SERVER_URL")
			os.Unsetenv("TUNNEL_TOKEN")
			os.Unsetenv("TUNNEL_GATEWAY_ID")

			setEnvs(t, tt.envs)

			_, err := LoadConfigFromEnv()
			if err == nil {
				t.Fatal("expected error, got nil")
			}
			if err.Error() != tt.wantErr {
				t.Errorf("error: got %q, want %q", err.Error(), tt.wantErr)
			}
		})
	}
}

func TestLoadConfigFromEnv_Defaults(t *testing.T) {
	// Clear optional vars to ensure defaults are used.
	os.Unsetenv("TUNNEL_AGENT_VERSION")
	os.Unsetenv("TUNNEL_LOCAL_HOST")
	os.Unsetenv("TUNNEL_LOCAL_PORT")
	os.Unsetenv("TUNNEL_PING_INTERVAL_MS")
	os.Unsetenv("TUNNEL_RECONNECT_INITIAL_MS")
	os.Unsetenv("TUNNEL_RECONNECT_MAX_MS")

	setEnvs(t, map[string]string{
		"TUNNEL_SERVER_URL": "wss://broker.example.com",
		"TUNNEL_TOKEN":      "tok",
		"TUNNEL_GATEWAY_ID": "gw-1",
	})

	cfg, err := LoadConfigFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.AgentVersion != "1.0.0" {
		t.Errorf("AgentVersion default: got %q, want %q", cfg.AgentVersion, "1.0.0")
	}
	if cfg.LocalHost != "127.0.0.1" {
		t.Errorf("LocalHost default: got %q, want %q", cfg.LocalHost, "127.0.0.1")
	}
	if cfg.LocalPort != 0 {
		t.Errorf("LocalPort default: got %d, want 0", cfg.LocalPort)
	}
	if cfg.PingInterval != 15*time.Second {
		t.Errorf("PingInterval default: got %v, want %v", cfg.PingInterval, 15*time.Second)
	}
	if cfg.ReconnectInitial != 1*time.Second {
		t.Errorf("ReconnectInitial default: got %v, want %v", cfg.ReconnectInitial, 1*time.Second)
	}
	if cfg.ReconnectMax != 60*time.Second {
		t.Errorf("ReconnectMax default: got %v, want %v", cfg.ReconnectMax, 60*time.Second)
	}
}

func TestLoadConfigFromEnv_CustomOptional(t *testing.T) {
	setEnvs(t, map[string]string{
		"TUNNEL_SERVER_URL":          "wss://custom.example.com",
		"TUNNEL_TOKEN":               "custom-tok",
		"TUNNEL_GATEWAY_ID":          "gw-custom",
		"TUNNEL_AGENT_VERSION":       "3.5.0",
		"TUNNEL_LOCAL_HOST":          "0.0.0.0",
		"TUNNEL_LOCAL_PORT":          "8080",
		"TUNNEL_PING_INTERVAL_MS":    "5000",
		"TUNNEL_RECONNECT_INITIAL_MS": "2000",
		"TUNNEL_RECONNECT_MAX_MS":    "30000",
	})

	cfg, err := LoadConfigFromEnv()
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	if cfg.AgentVersion != "3.5.0" {
		t.Errorf("AgentVersion: got %q, want %q", cfg.AgentVersion, "3.5.0")
	}
	if cfg.LocalHost != "0.0.0.0" {
		t.Errorf("LocalHost: got %q, want %q", cfg.LocalHost, "0.0.0.0")
	}
	if cfg.LocalPort != 8080 {
		t.Errorf("LocalPort: got %d, want 8080", cfg.LocalPort)
	}
	if cfg.PingInterval != 5*time.Second {
		t.Errorf("PingInterval: got %v, want %v", cfg.PingInterval, 5*time.Second)
	}
	if cfg.ReconnectInitial != 2*time.Second {
		t.Errorf("ReconnectInitial: got %v, want %v", cfg.ReconnectInitial, 2*time.Second)
	}
	if cfg.ReconnectMax != 30*time.Second {
		t.Errorf("ReconnectMax: got %v, want %v", cfg.ReconnectMax, 30*time.Second)
	}
}

func TestEnvInt_ValidAndInvalid(t *testing.T) {
	tests := []struct {
		name string
		val  string
		def  int
		want int
	}{
		{"valid positive", "42", 0, 42},
		{"valid zero", "0", 99, 0},
		{"valid negative", "-5", 0, -5},
		{"invalid non-numeric falls back to default", "abc", 10, 10},
		{"empty string falls back to default", "", 7, 7},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := "TEST_ENV_INT_" + tt.name
			if tt.val != "" {
				t.Setenv(key, tt.val)
			} else {
				os.Unsetenv(key)
			}

			got := envInt(key, tt.def)
			if got != tt.want {
				t.Errorf("envInt(%q, %d): got %d, want %d", key, tt.def, got, tt.want)
			}
		})
	}
}

func TestEnvOrDefault(t *testing.T) {
	tests := []struct {
		name string
		val  string
		def  string
		want string
	}{
		{"set value is returned", "custom", "default", "custom"},
		{"empty value returns default", "", "fallback", "fallback"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			key := "TEST_ENV_OR_DEFAULT_" + tt.name
			if tt.val != "" {
				t.Setenv(key, tt.val)
			} else {
				os.Unsetenv(key)
			}

			got := envOrDefault(key, tt.def)
			if got != tt.want {
				t.Errorf("envOrDefault(%q, %q): got %q, want %q", key, tt.def, got, tt.want)
			}
		})
	}
}
