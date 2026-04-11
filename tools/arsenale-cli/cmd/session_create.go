package cmd

import (
	"encoding/json"

	"github.com/spf13/cobra"
)

var sessionCreateColumnsSSH = []Column{
	{Header: "SESSION_ID", Field: "sessionId"},
	{Header: "TRANSPORT", Field: "transport"},
	{Header: "SFTP_SUPPORTED", Field: "sftpSupported"},
	{Header: "EXPIRES_AT", Field: "expiresAt"},
}

var sessionCreateColumnsRDP = []Column{
	{Header: "SESSION_ID", Field: "sessionId"},
	{Header: "ENABLE_DRIVE", Field: "enableDrive"},
	{Header: "RESOLVED_USERNAME", Field: "resolvedUsername"},
	{Header: "RESOLVED_DOMAIN", Field: "resolvedDomain"},
	{Header: "RECORDING_ID", Field: "recordingId"},
}

var sessionCreateColumnsDB = []Column{
	{Header: "SESSION_ID", Field: "sessionId"},
	{Header: "PROTOCOL", Field: "protocol"},
	{Header: "PROXY_HOST", Field: "proxyHost"},
	{Header: "PROXY_PORT", Field: "proxyPort"},
	{Header: "DATABASE", Field: "databaseName"},
	{Header: "USERNAME", Field: "username"},
}

var sessionDBConfigColumns = []Column{
	{Header: "ACTIVE_DATABASE", Field: "activeDatabase"},
	{Header: "TIMEZONE", Field: "timezone"},
	{Header: "SEARCH_PATH", Field: "searchPath"},
	{Header: "ENCODING", Field: "encoding"},
	{Header: "INIT_COMMANDS", Field: "initCommands"},
}

var sessionDBConfigSetColumns = []Column{
	{Header: "APPLIED", Field: "applied"},
	{Header: "ACTIVE_DATABASE", Field: "activeDatabase"},
	{Header: "SESSION_CONFIG", Field: "sessionConfig"},
}

var sessionCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create an owned session for smoke testing",
}

var sessionCreateSSHCmd = &cobra.Command{
	Use:   "ssh <connection-name-or-id>",
	Short: "Create an SSH session",
	Args:  cobra.ExactArgs(1),
	Run:   runSessionCreateSSH,
}

var sessionCreateRDPCmd = &cobra.Command{
	Use:   "rdp <connection-name-or-id>",
	Short: "Create an RDP session",
	Args:  cobra.ExactArgs(1),
	Run:   runSessionCreateRDP,
}

var sessionCreateDatabaseCmd = &cobra.Command{
	Use:   "database <connection-name-or-id>",
	Short: "Create a database session",
	Args:  cobra.ExactArgs(1),
	Run:   runSessionCreateDatabase,
}

var sessionDBConfigCmd = &cobra.Command{
	Use:   "database-config",
	Short: "Inspect or change owned database session settings",
}

var sessionDBConfigGetCmd = &cobra.Command{
	Use:   "get <session-id>",
	Short: "Get current database session settings",
	Args:  cobra.ExactArgs(1),
	Run:   runSessionDBConfigGet,
}

var sessionDBConfigSetCmd = &cobra.Command{
	Use:   "set <session-id>",
	Short: "Apply database session settings from a JSON or YAML file",
	Args:  cobra.ExactArgs(1),
	Run:   runSessionDBConfigSet,
}

var (
	sessionCreateOverrides credentialOverride
	sessionDBConfigFile    string
)

func init() {
	sessionCmd.AddCommand(sessionCreateCmd)
	sessionCreateCmd.AddCommand(sessionCreateSSHCmd)
	sessionCreateCmd.AddCommand(sessionCreateRDPCmd)
	sessionCreateCmd.AddCommand(sessionCreateDatabaseCmd)

	sessionCmd.AddCommand(sessionDBConfigCmd)
	sessionDBConfigCmd.AddCommand(sessionDBConfigGetCmd)
	sessionDBConfigCmd.AddCommand(sessionDBConfigSetCmd)

	addCredentialOverrideFlags(sessionCreateSSHCmd, &sessionCreateOverrides)
	addCredentialOverrideFlags(sessionCreateRDPCmd, &sessionCreateOverrides)
	addCredentialOverrideFlags(sessionCreateDatabaseCmd, &sessionCreateOverrides)

	sessionDBConfigSetCmd.Flags().StringVarP(&sessionDBConfigFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	sessionDBConfigSetCmd.MarkFlagRequired("from-file")
}

func runSessionCreateSSH(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(args[0], cfg, sessionCreateOverrides)
	if conn.Type != "SSH" {
		fatal("connection %q is type %s, not SSH", conn.Name, conn.Type)
	}

	respBody, status, err := apiPost("/api/sessions/ssh", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintSingle(respBody, sessionCreateColumnsSSH); err != nil {
		fatal("%v", err)
	}
}

func runSessionCreateRDP(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn, body := buildConnectionCredentialBody(args[0], cfg, sessionCreateOverrides)
	if conn.Type != "RDP" {
		fatal("connection %q is type %s, not RDP", conn.Name, conn.Type)
	}

	respBody, status, err := apiPost("/api/sessions/rdp", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintSingle(respBody, sessionCreateColumnsRDP); err != nil {
		fatal("%v", err)
	}
}

func runSessionCreateDatabase(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	conn := resolveConnectionOrFatal(args[0], cfg)
	if conn.Type != "DATABASE" {
		fatal("connection %q is type %s, not DATABASE", conn.Name, conn.Type)
	}

	body := map[string]any{
		"connectionId": conn.ID,
	}
	if value := sessionCreateOverrides.Username; value != "" {
		body["username"] = value
	}
	if value := sessionCreateOverrides.Password; value != "" {
		body["password"] = value
	}

	respBody, status, err := apiPost("/api/sessions/database", body, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintSingle(respBody, sessionCreateColumnsDB); err != nil {
		fatal("%v", err)
	}
}

func runSessionDBConfigGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	respBody, status, err := apiGet("/api/sessions/database/"+args[0]+"/config", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintSingle(respBody, sessionDBConfigColumns); err != nil {
		fatal("%v", err)
	}
}

func runSessionDBConfigSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payloadData, err := readResourceFromFileOrStdin(sessionDBConfigFile)
	if err != nil {
		fatal("%v", err)
	}

	var sessionConfig any
	if err := json.Unmarshal(payloadData, &sessionConfig); err != nil {
		fatal("parse session config: %v", err)
	}

	respBody, status, err := apiPut("/api/sessions/database/"+args[0]+"/config", map[string]any{
		"sessionConfig": sessionConfig,
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().PrintSingle(respBody, sessionDBConfigSetColumns); err != nil {
		fatal("%v", err)
	}
}
