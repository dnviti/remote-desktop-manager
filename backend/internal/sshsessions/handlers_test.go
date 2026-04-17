package sshsessions

import (
	"encoding/json"
	"testing"
	"time"
)

func TestCreateResponseJSONShape(t *testing.T) {
	now := time.Now().UTC().Truncate(time.Second)
	resp := createResponse{
		Transport:           "terminal-broker",
		SessionID:          "sess-123",
		Token:              "tok-abc",
		ExpiresAt:          now,
		WebSocketPath:      "/ws/terminal",
		WebSocketURL:       "wss://localhost/ws/terminal?token=tok-abc",
		DLPPolicy:          resolvedDLP{DisableCopy: true, DisablePaste: false},
		EnforcedSSHSettings: map[string]any{"shell": "/bin/bash"},
		SFTPSupported:       false,
		FileBrowserSupported: true,
	}

	data, err := json.Marshal(resp)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}

	var roundTrip map[string]any
	if err := json.Unmarshal(data, &roundTrip); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}

	if got := roundTrip["transport"]; got != "terminal-broker" {
		t.Errorf("transport = %v; want terminal-broker", got)
	}
	if got := roundTrip["sessionId"]; got != "sess-123" {
		t.Errorf("sessionId = %v; want sess-123", got)
	}
	if got := roundTrip["sftpSupported"]; got != false {
		t.Errorf("sftpSupported = %v; want false", got)
	}
	if got := roundTrip["fileBrowserSupported"]; got != true {
		t.Errorf("fileBrowserSupported = %v; want true", got)
	}
}

func TestCreateResponseSFTPSupportedFalseForTransition(t *testing.T) {
	// Verify the hardcoded values match the transition requirement:
	// sftpSupported=false, fileBrowserSupported=true
	resp := createResponse{
		Transport:            "terminal-broker",
		SessionID:           "sess-456",
		Token:               "tok-def",
		ExpiresAt:           time.Now().UTC().Truncate(time.Second),
		WebSocketPath:       "/ws/terminal",
		WebSocketURL:        "wss://localhost/ws/terminal",
		SFTPSupported:       false,
		FileBrowserSupported: true,
	}

	if resp.SFTPSupported {
		t.Error("SFTPSupported should be false during transition")
	}
	if !resp.FileBrowserSupported {
		t.Error("FileBrowserSupported should be true")
	}
}
