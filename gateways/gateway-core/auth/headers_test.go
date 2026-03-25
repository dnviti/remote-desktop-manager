package auth

import "testing"

func TestBuildAuthHeaders(t *testing.T) {
	tests := []struct {
		name      string
		token     string
		gatewayID string
		version   string
		wantAuth  string
		wantGwID  string
		wantVer   string
	}{
		{
			name:      "standard headers",
			token:     "abc123",
			gatewayID: "gw-prod-01",
			version:   "2.1.0",
			wantAuth:  "Bearer abc123",
			wantGwID:  "gw-prod-01",
			wantVer:   "2.1.0",
		},
		{
			name:      "empty version still produces header",
			token:     "token-xyz",
			gatewayID: "gw-dev",
			version:   "",
			wantAuth:  "Bearer token-xyz",
			wantGwID:  "gw-dev",
			wantVer:   "",
		},
		{
			name:      "token with special characters",
			token:     "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
			gatewayID: "gw-test-99",
			version:   "0.0.1-alpha",
			wantAuth:  "Bearer a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4",
			wantGwID:  "gw-test-99",
			wantVer:   "0.0.1-alpha",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := BuildAuthHeaders(tt.token, tt.gatewayID, tt.version)

			if got := h.Get("Authorization"); got != tt.wantAuth {
				t.Errorf("Authorization: got %q, want %q", got, tt.wantAuth)
			}
			if got := h.Get("X-Gateway-Id"); got != tt.wantGwID {
				t.Errorf("X-Gateway-Id: got %q, want %q", got, tt.wantGwID)
			}
			if got := h.Get("X-Agent-Version"); got != tt.wantVer {
				t.Errorf("X-Agent-Version: got %q, want %q", got, tt.wantVer)
			}
		})
	}
}

func TestBuildAuthHeadersBearerPrefix(t *testing.T) {
	h := BuildAuthHeaders("mytoken", "gw-1", "1.0.0")
	auth := h.Get("Authorization")
	if len(auth) < 7 || auth[:7] != "Bearer " {
		t.Errorf("Authorization header should start with 'Bearer ', got %q", auth)
	}
}
