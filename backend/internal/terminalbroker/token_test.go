package terminalbroker

import (
	"os"
	"strings"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestIssueAndValidateGrant(t *testing.T) {
	grant := contracts.TerminalSessionGrant{
		SessionID: "session-1",
		UserID:    "user-1",
		ExpiresAt: time.Now().UTC().Add(2 * time.Minute),
		Target: contracts.TerminalEndpoint{
			Host:     "terminal-target",
			Port:     2224,
			Username: "acceptance",
			Password: "acceptance",
		},
	}

	token, err := IssueGrant("secret", grant)
	if err != nil {
		t.Fatalf("IssueGrant() error = %v", err)
	}
	if token == "" {
		t.Fatal("IssueGrant() returned empty token")
	}

	validated, err := ValidateGrant("secret", token, time.Now().UTC())
	if err != nil {
		t.Fatalf("ValidateGrant() error = %v", err)
	}
	if validated.Target.Host != grant.Target.Host {
		t.Fatalf("validated target host = %q, want %q", validated.Target.Host, grant.Target.Host)
	}
	if validated.Target.Password != grant.Target.Password {
		t.Fatalf("validated target password mismatch")
	}
	if validated.Terminal.Term != "xterm-256color" || validated.Terminal.Cols != 80 || validated.Terminal.Rows != 24 {
		t.Fatalf("validated default terminal = %+v, want xterm-256color/80x24", validated.Terminal)
	}
}

func TestValidateGrantRejectsExpired(t *testing.T) {
	token, err := IssueGrant("secret", contracts.TerminalSessionGrant{
		ExpiresAt: time.Now().UTC().Add(-1 * time.Minute),
		Target: contracts.TerminalEndpoint{
			Host:     "terminal-target",
			Username: "acceptance",
			Password: "acceptance",
		},
	})
	if err != nil {
		t.Fatalf("IssueGrant() error = %v", err)
	}

	if _, err := ValidateGrant("secret", token, time.Now().UTC()); err == nil {
		t.Fatal("ValidateGrant() error = nil, want expired grant error")
	}
}

func TestIssueAndValidateObserverGrant(t *testing.T) {
	grant := contracts.TerminalSessionGrant{
		Mode:      contracts.TerminalSessionModeObserve,
		SessionID: "session-1",
		UserID:    "observer-1",
		ExpiresAt: time.Now().UTC().Add(2 * time.Minute),
	}

	token, err := IssueGrant("secret", grant)
	if err != nil {
		t.Fatalf("IssueGrant() error = %v", err)
	}

	validated, err := ValidateGrant("secret", token, time.Now().UTC())
	if err != nil {
		t.Fatalf("ValidateGrant() error = %v", err)
	}
	if validated.Mode != contracts.TerminalSessionModeObserve {
		t.Fatalf("validated mode = %q, want %q", validated.Mode, contracts.TerminalSessionModeObserve)
	}
	if validated.SessionID != grant.SessionID {
		t.Fatalf("validated sessionId = %q, want %q", validated.SessionID, grant.SessionID)
	}
	if validated.Target.Host != "" {
		t.Fatalf("validated observer target host = %q, want empty", validated.Target.Host)
	}
}

func TestIssueGrantRejectsObserverWithoutSessionID(t *testing.T) {
	_, err := IssueGrant("secret", contracts.TerminalSessionGrant{Mode: contracts.TerminalSessionModeObserve})
	if err == nil {
		t.Fatal("IssueGrant() error = nil, want observe sessionId validation error")
	}
	if !strings.Contains(err.Error(), "sessionId is required for observe grants") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadSecretUsesTrimmedTerminalBrokerSecret(t *testing.T) {
	t.Setenv("TERMINAL_BROKER_SECRET", "  terminal-secret \n")
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET_FILE")
	_ = os.Unsetenv("GUACAMOLE_SECRET")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	secret, err := LoadSecret()
	if err != nil {
		t.Fatalf("LoadSecret() error = %v", err)
	}
	if secret != "terminal-secret" {
		t.Fatalf("LoadSecret() = %q, want terminal-secret", secret)
	}
}

func TestLoadSecretFallsBackToGuacamoleSecret(t *testing.T) {
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET")
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET_FILE")
	t.Setenv("GUACAMOLE_SECRET", "  guac-secret \n")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	secret, err := LoadSecret()
	if err != nil {
		t.Fatalf("LoadSecret() error = %v", err)
	}
	if secret != "guac-secret" {
		t.Fatalf("LoadSecret() = %q, want guac-secret", secret)
	}
}

func TestLoadSecretPrefersTerminalBrokerSecretOverFallback(t *testing.T) {
	t.Setenv("TERMINAL_BROKER_SECRET", " terminal-secret ")
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET_FILE")
	t.Setenv("GUACAMOLE_SECRET", "guac-secret")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	secret, err := LoadSecret()
	if err != nil {
		t.Fatalf("LoadSecret() error = %v", err)
	}
	if secret != "terminal-secret" {
		t.Fatalf("LoadSecret() = %q, want terminal-secret", secret)
	}
}

func TestLoadSecretRejectsWhitespaceOnlyTerminalBrokerSecret(t *testing.T) {
	t.Setenv("TERMINAL_BROKER_SECRET", " \t\r\n ")
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET_FILE")
	t.Setenv("GUACAMOLE_SECRET", "guac-secret")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	_, err := LoadSecret()
	if err == nil {
		t.Fatal("LoadSecret() error = nil, want invalid terminal secret error")
	}
	if !strings.Contains(err.Error(), "TERMINAL_BROKER_SECRET is set but empty") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadSecretRejectsWhitespaceOnlyTerminalBrokerSecretFile(t *testing.T) {
	file, err := os.CreateTemp(t.TempDir(), "terminal-secret-*")
	if err != nil {
		t.Fatalf("CreateTemp() error = %v", err)
	}
	if _, err := file.WriteString(" \r\n\t "); err != nil {
		t.Fatalf("WriteString() error = %v", err)
	}
	if err := file.Close(); err != nil {
		t.Fatalf("Close() error = %v", err)
	}

	_ = os.Unsetenv("TERMINAL_BROKER_SECRET")
	t.Setenv("TERMINAL_BROKER_SECRET_FILE", file.Name())
	t.Setenv("GUACAMOLE_SECRET", "guac-secret")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	_, err = LoadSecret()
	if err == nil {
		t.Fatal("LoadSecret() error = nil, want invalid terminal secret file error")
	}
	if !strings.Contains(err.Error(), "TERMINAL_BROKER_SECRET_FILE points to an empty secret") {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestLoadSecretRejectsWhitespaceOnlyFallbackGuacamoleSecret(t *testing.T) {
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET")
	_ = os.Unsetenv("TERMINAL_BROKER_SECRET_FILE")
	t.Setenv("GUACAMOLE_SECRET", " \t\r\n ")
	_ = os.Unsetenv("GUACAMOLE_SECRET_FILE")

	_, err := LoadSecret()
	if err == nil {
		t.Fatal("LoadSecret() error = nil, want invalid fallback secret error")
	}
	if !strings.Contains(err.Error(), "GUACAMOLE_SECRET is set but empty") {
		t.Fatalf("unexpected error: %v", err)
	}
}
