package desktopsessions

import (
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func TestBuildDesktopObserverConnectionTokenUsesJoinAndReadOnly(t *testing.T) {
	t.Parallel()

	token := buildDesktopObserverConnectionToken("RDP", sessions.TenantSessionSummary{
		ID:                "sess-1",
		ConnectionID:      "conn-1",
		GuacdConnectionID: "owner-connection-123",
	}, "observer-1", desktopRoute{GuacdHost: "desktop-proxy", GuacdPort: 4822}, time.Unix(1_700_000_000, 0).UTC())

	if token.Connection.Type != "rdp" {
		t.Fatalf("connection type = %q, want %q", token.Connection.Type, "rdp")
	}
	if token.Connection.Join != "owner-connection-123" {
		t.Fatalf("join selector = %q, want %q", token.Connection.Join, "owner-connection-123")
	}
	if token.Connection.GuacdHost != "desktop-proxy" || token.Connection.GuacdPort != 4822 {
		t.Fatalf("unexpected guacd target: %#v", token.Connection)
	}
	if got := token.Connection.Settings["read-only"]; got != "true" {
		t.Fatalf("read-only setting = %v, want %q", got, "true")
	}
	if got := desktopbroker.MetadataString(token.Metadata, desktopbroker.MetadataKeyObserveSessionID); got != "sess-1" {
		t.Fatalf("observe session id metadata = %q, want %q", got, "sess-1")
	}
	if got := desktopbroker.MetadataString(token.Metadata, "userId"); got != "observer-1" {
		t.Fatalf("observer user id metadata = %q, want %q", got, "observer-1")
	}
	if got := token.ExpiresAt.UTC(); got != time.Unix(1_700_000_000, 0).UTC() {
		t.Fatalf("token expiry = %s, want %s", got, time.Unix(1_700_000_000, 0).UTC())
	}
}
