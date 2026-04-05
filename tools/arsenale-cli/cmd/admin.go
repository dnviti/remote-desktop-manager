package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

// Top-level command
var adminCmd = &cobra.Command{
	Use:   "admin",
	Short: "Manage system administration settings",
}

// --- Settings subcommands ---

var adminSettingsCmd = &cobra.Command{
	Use:   "settings",
	Short: "Manage system settings",
}

var adminSettingsListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all system settings",
	Run:   runAdminSettingsList,
}

var adminSettingsSetCmd = &cobra.Command{
	Use:   "set <key>",
	Short: "Set a system setting",
	Args:  cobra.ExactArgs(1),
	Run:   runAdminSettingsSet,
}

var adminSettingsBulkSetCmd = &cobra.Command{
	Use:   "bulk-set",
	Short: "Bulk update system settings",
	Long:  `Bulk update settings from a JSON/YAML file: arsenale admin settings bulk-set --from-file settings.yaml`,
	Run:   runAdminSettingsBulkSet,
}

var adminSettingsDbStatusCmd = &cobra.Command{
	Use:   "db-status",
	Short: "Get database status",
	Run:   runAdminSettingsDbStatus,
}

// --- Email subcommands ---

var adminEmailCmd = &cobra.Command{
	Use:   "email",
	Short: "Manage email configuration",
}

var adminEmailStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Get email configuration status",
	Run:   runAdminEmailStatus,
}

var adminEmailTestCmd = &cobra.Command{
	Use:   "test",
	Short: "Send a test email",
	Run:   runAdminEmailTest,
}

// --- App config subcommands ---

var adminAppConfigCmd = &cobra.Command{
	Use:   "app-config",
	Short: "Manage application configuration",
}

var adminAppConfigGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get application configuration",
	Run:   runAdminAppConfigGet,
}

var adminAppConfigSelfSignupCmd = &cobra.Command{
	Use:   "self-signup",
	Short: "Configure self-signup",
	Run:   runAdminAppConfigSelfSignup,
}

// --- Auth providers ---

var adminAuthProvidersCmd = &cobra.Command{
	Use:   "auth-providers",
	Short: "List authentication providers",
	Run:   runAdminAuthProviders,
}

// --- GeoIP ---

var adminGeoIPCmd = &cobra.Command{
	Use:   "geoip <ip>",
	Short: "Look up GeoIP information for an IP address",
	Args:  cobra.ExactArgs(1),
	Run:   runAdminGeoIP,
}

var (
	adminSettingsValue     string
	adminSettingsFromFile  string
	adminEmailTo           string
	adminSelfSignupEnabled bool
)

func init() {
	rootCmd.AddCommand(adminCmd)

	// Settings
	adminCmd.AddCommand(adminSettingsCmd)
	adminSettingsCmd.AddCommand(adminSettingsListCmd)
	adminSettingsCmd.AddCommand(adminSettingsSetCmd)
	adminSettingsCmd.AddCommand(adminSettingsBulkSetCmd)
	adminSettingsCmd.AddCommand(adminSettingsDbStatusCmd)

	adminSettingsSetCmd.Flags().StringVar(&adminSettingsValue, "value", "", "Setting value")
	adminSettingsSetCmd.MarkFlagRequired("value")

	adminSettingsBulkSetCmd.Flags().StringVarP(&adminSettingsFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	adminSettingsBulkSetCmd.MarkFlagRequired("from-file")

	// Email
	adminCmd.AddCommand(adminEmailCmd)
	adminEmailCmd.AddCommand(adminEmailStatusCmd)
	adminEmailCmd.AddCommand(adminEmailTestCmd)

	adminEmailTestCmd.Flags().StringVar(&adminEmailTo, "to", "", "Recipient email address")
	adminEmailTestCmd.MarkFlagRequired("to")

	// App config
	adminCmd.AddCommand(adminAppConfigCmd)
	adminAppConfigCmd.AddCommand(adminAppConfigGetCmd)
	adminAppConfigCmd.AddCommand(adminAppConfigSelfSignupCmd)

	adminAppConfigSelfSignupCmd.Flags().BoolVar(&adminSelfSignupEnabled, "enabled", false, "Enable or disable self-signup")

	// Auth providers
	adminCmd.AddCommand(adminAuthProvidersCmd)

	// GeoIP
	adminCmd.AddCommand(adminGeoIPCmd)
}

// --- Settings run functions ---

func runAdminSettingsList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/admin/system-settings", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "KEY", Field: "key"},
		{Header: "VALUE", Field: "value"},
	})
}

func runAdminSettingsSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]string{
		"value": adminSettingsValue,
	}

	body, status, err := apiPut(fmt.Sprintf("/api/admin/system-settings/%s", args[0]), payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	if !quiet {
		fmt.Printf("Setting %q updated\n", args[0])
	}
}

func runAdminSettingsBulkSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(adminSettingsFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut("/api/admin/system-settings", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	if !quiet {
		fmt.Println("System settings updated")
	}
}

func runAdminSettingsDbStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/admin/system-settings/db-status", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "STATUS", Field: "status"},
		{Header: "VERSION", Field: "version"},
	})
}

// --- Email run functions ---

func runAdminEmailStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/admin/email/status", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "STATUS", Field: "status"},
		{Header: "PROVIDER", Field: "provider"},
	})
}

func runAdminEmailTest(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]string{
		"to": adminEmailTo,
	}

	body, status, err := apiPost("/api/admin/email/test", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	if !quiet {
		fmt.Printf("Test email sent to %s\n", adminEmailTo)
	}
}

// --- App config run functions ---

func runAdminAppConfigGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/admin/app-config", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "SELF_SIGNUP", Field: "selfSignup"},
		{Header: "VERSION", Field: "version"},
	})
}

func runAdminAppConfigSelfSignup(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]interface{}{
		"enabled": adminSelfSignupEnabled,
	}

	body, status, err := apiPut("/api/admin/app-config/self-signup", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	if !quiet {
		fmt.Printf("Self-signup %s\n", func() string {
			if adminSelfSignupEnabled {
				return "enabled"
			}
			return "disabled"
		}())
	}
}

// --- Auth providers run function ---

func runAdminAuthProviders(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/admin/auth-providers", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "ID", Field: "id"},
		{Header: "NAME", Field: "name"},
		{Header: "TYPE", Field: "type"},
		{Header: "ENABLED", Field: "enabled"},
	})
}

// --- GeoIP run function ---

func runAdminGeoIP(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}
	if err := ensureIPGeolocationEnabled(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/geoip/%s", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "IP", Field: "ip"},
		{Header: "COUNTRY", Field: "country"},
		{Header: "CITY", Field: "city"},
		{Header: "LATITUDE", Field: "latitude"},
		{Header: "LONGITUDE", Field: "longitude"},
	})
}
