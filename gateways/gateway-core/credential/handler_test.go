package credential

import (
	"encoding/json"
	"testing"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

func makeCredFrame(sessionID string, creds Credentials) *protocol.Frame {
	payload := credentialPushPayload{
		SessionID:   sessionID,
		Credentials: creds,
	}
	data, _ := json.Marshal(payload)
	return &protocol.Frame{
		Type:    protocol.MsgCredentialPush,
		Payload: data,
	}
}

func TestHandlePushAndGet(t *testing.T) {
	ch := NewCredentialHandler()

	frame := makeCredFrame("sess-1", Credentials{
		Username:   "admin",
		Password:   "s3cret",
		PrivateKey: "-----BEGIN RSA PRIVATE KEY-----\ntest\n-----END RSA PRIVATE KEY-----",
		Extra:      map[string]string{"domain": "CORP"},
	})

	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	creds, err := ch.GetCredentials("sess-1")
	if err != nil {
		t.Fatalf("GetCredentials: %v", err)
	}
	if creds.Username != "admin" {
		t.Errorf("username: got %q, want %q", creds.Username, "admin")
	}
	if creds.Password != "s3cret" {
		t.Errorf("password: got %q, want %q", creds.Password, "s3cret")
	}
	if creds.Extra["domain"] != "CORP" {
		t.Errorf("extra[domain]: got %q, want %q", creds.Extra["domain"], "CORP")
	}
}

func TestGetCredentialsCopy(t *testing.T) {
	ch := NewCredentialHandler()

	frame := makeCredFrame("sess-2", Credentials{
		Username: "user",
		Extra:    map[string]string{"key": "val"},
	})
	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	// Modify the returned copy — should not affect stored credentials.
	creds, _ := ch.GetCredentials("sess-2")
	creds.Username = "modified"
	creds.Extra["key"] = "modified"

	original, _ := ch.GetCredentials("sess-2")
	if original.Username != "user" {
		t.Error("GetCredentials did not return a copy — username was mutated")
	}
	if original.Extra["key"] != "val" {
		t.Error("GetCredentials did not return a copy — Extra map was mutated")
	}
}

func TestClearCredentials(t *testing.T) {
	ch := NewCredentialHandler()

	frame := makeCredFrame("sess-3", Credentials{
		Username: "admin",
		Password: "password123",
	})
	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	ch.ClearCredentials("sess-3")

	_, err := ch.GetCredentials("sess-3")
	if err == nil {
		t.Error("expected error after ClearCredentials")
	}
}

func TestClearAll(t *testing.T) {
	ch := NewCredentialHandler()

	for _, sid := range []string{"sess-a", "sess-b", "sess-c"} {
		frame := makeCredFrame(sid, Credentials{Username: sid})
		if err := ch.HandlePush(frame); err != nil {
			t.Fatalf("HandlePush for %s: %v", sid, err)
		}
	}

	ch.ClearAll()

	for _, sid := range []string{"sess-a", "sess-b", "sess-c"} {
		_, err := ch.GetCredentials(sid)
		if err == nil {
			t.Errorf("expected error for %s after ClearAll", sid)
		}
	}
}

func TestSecureZeroing(t *testing.T) {
	ch := NewCredentialHandler()

	frame := makeCredFrame("sess-z", Credentials{
		Username:   "admin",
		Password:   "TopSecret!",
		PrivateKey: "key-data",
		Passphrase: "pass",
		Extra:      map[string]string{"token": "abc123"},
	})
	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	// Get a reference before clearing (via internal access for testing)
	ch.mu.RLock()
	stored := ch.store["sess-z"]
	ch.mu.RUnlock()

	ch.ClearCredentials("sess-z")

	// After zeroing, the stored struct's fields should be zeroed strings.
	if stored.Password != "\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" {
		t.Errorf("password not zeroed: got %q", stored.Password)
	}
	if stored.PrivateKey != "\x00\x00\x00\x00\x00\x00\x00\x00" {
		t.Errorf("privateKey not zeroed: got %q", stored.PrivateKey)
	}
}

func TestGetNotFound(t *testing.T) {
	ch := NewCredentialHandler()
	_, err := ch.GetCredentials("nonexistent")
	if err == nil {
		t.Error("expected error for nonexistent session")
	}
}

func TestOverwriteExistingCredentials(t *testing.T) {
	ch := NewCredentialHandler()

	frame1 := makeCredFrame("sess-ow", Credentials{Username: "old"})
	if err := ch.HandlePush(frame1); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	frame2 := makeCredFrame("sess-ow", Credentials{Username: "new"})
	if err := ch.HandlePush(frame2); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	creds, err := ch.GetCredentials("sess-ow")
	if err != nil {
		t.Fatalf("GetCredentials: %v", err)
	}
	if creds.Username != "new" {
		t.Errorf("expected overwritten credentials, got %q", creds.Username)
	}
}
