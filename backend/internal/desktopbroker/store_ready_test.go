package desktopbroker

import (
	"encoding/json"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func TestDesktopConnectionReadyMetadataPayload(t *testing.T) {
	payload, err := json.Marshal(map[string]string{
		sessions.MetadataKeyDesktopConnectionID: "conn-123",
	})
	if err != nil {
		t.Fatalf("marshal metadata payload: %v", err)
	}

	var decoded map[string]string
	if err := json.Unmarshal(payload, &decoded); err != nil {
		t.Fatalf("unmarshal metadata payload: %v", err)
	}

	if got := decoded[sessions.MetadataKeyDesktopConnectionID]; got != "conn-123" {
		t.Fatalf("metadata payload desktopConnectionId = %q; want %q", got, "conn-123")
	}
}
