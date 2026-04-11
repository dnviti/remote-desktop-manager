package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/spf13/cobra"
)

type credentialOverride struct {
	Username       string
	Password       string
	Domain         string
	CredentialMode string
}

func addCredentialOverrideFlags(cmd *cobra.Command, overrides *credentialOverride) {
	cmd.Flags().StringVar(&overrides.Username, "username", "", "Override username for this request")
	cmd.Flags().StringVar(&overrides.Password, "password", "", "Override password for this request")
	cmd.Flags().StringVar(&overrides.Domain, "domain", "", "Override domain for this request")
	cmd.Flags().StringVar(&overrides.CredentialMode, "credential-mode", "", "Credential mode override")
}

func resolveConnectionOrFatal(connectionRef string, cfg *CLIConfig) Connection {
	conn, err := findConnectionByName(strings.TrimSpace(connectionRef), cfg)
	if err != nil {
		fatal("%v", err)
	}
	return *conn
}

func buildConnectionCredentialBody(connectionRef string, cfg *CLIConfig, overrides credentialOverride) (Connection, map[string]any) {
	conn := resolveConnectionOrFatal(connectionRef, cfg)
	body := map[string]any{
		"connectionId": conn.ID,
	}
	if value := strings.TrimSpace(overrides.Username); value != "" {
		body["username"] = value
	}
	if value := strings.TrimSpace(overrides.Password); value != "" {
		body["password"] = value
	}
	if value := strings.TrimSpace(overrides.Domain); value != "" {
		body["domain"] = value
	}
	if value := strings.TrimSpace(overrides.CredentialMode); value != "" {
		body["credentialMode"] = value
	}
	return conn, body
}

func extractWrappedJSONField(body []byte, field string) []byte {
	var payload map[string]json.RawMessage
	if err := json.Unmarshal(body, &payload); err != nil {
		fatal("failed to parse response: %v", err)
	}
	value, ok := payload[field]
	if !ok {
		fatal("response is missing %q", field)
	}
	return value
}

func writeBytesToPath(destPath string, payload []byte) error {
	if err := os.MkdirAll(filepath.Dir(destPath), 0o755); err != nil {
		return fmt.Errorf("create parent directory: %w", err)
	}
	if err := os.WriteFile(destPath, payload, 0o600); err != nil {
		return fmt.Errorf("write file: %w", err)
	}
	return nil
}
