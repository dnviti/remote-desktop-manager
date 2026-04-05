package cmd

import (
	"fmt"

	"github.com/spf13/cobra"
)

var auditColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "USER", Field: "user"},
	{Header: "ACTION", Field: "action"},
	{Header: "CONNECTION", Field: "connection"},
	{Header: "TIMESTAMP", Field: "timestamp"},
	{Header: "IP", Field: "ip"},
}

var auditCmd = &cobra.Command{
	Use:   "audit",
	Short: "Manage audit logs",
}

var auditListCmd = &cobra.Command{
	Use:   "list",
	Short: "List audit entries",
	Run:   runAuditList,
}

var auditTenantCmd = &cobra.Command{
	Use:   "tenant",
	Short: "Get tenant audit summary",
	Run:   runAuditTenant,
}

var auditConnectionCmd = &cobra.Command{
	Use:   "connection <connectionId>",
	Short: "Get audit entries for a connection",
	Args:  cobra.ExactArgs(1),
	Run:   runAuditConnection,
}

var auditConnectionUsersCmd = &cobra.Command{
	Use:   "connection-users <connectionId>",
	Short: "Get users for a connection audit",
	Args:  cobra.ExactArgs(1),
	Run:   runAuditConnectionUsers,
}

var auditSessionRecordingCmd = &cobra.Command{
	Use:   "session-recording <sessionId>",
	Short: "Get session recording audit",
	Args:  cobra.ExactArgs(1),
	Run:   runAuditSessionRecording,
}

var auditGatewaysCmd = &cobra.Command{
	Use:   "gateways",
	Short: "List gateway audit entries",
	Run:   runAuditGateways,
}

var auditCountriesCmd = &cobra.Command{
	Use:   "countries",
	Short: "List country audit entries",
	Run:   runAuditCountries,
}

var auditTenantGatewaysCmd = &cobra.Command{
	Use:   "tenant-gateways",
	Short: "List tenant gateway audit entries",
	Run:   runAuditTenantGateways,
}

var auditTenantCountriesCmd = &cobra.Command{
	Use:   "tenant-countries",
	Short: "List tenant country audit entries",
	Run:   runAuditTenantCountries,
}

var auditGeoSummaryCmd = &cobra.Command{
	Use:   "geo-summary",
	Short: "Get tenant geo summary",
	Run:   runAuditGeoSummary,
}

func init() {
	rootCmd.AddCommand(auditCmd)

	auditCmd.AddCommand(auditListCmd)
	auditCmd.AddCommand(auditTenantCmd)
	auditCmd.AddCommand(auditConnectionCmd)
	auditCmd.AddCommand(auditConnectionUsersCmd)
	auditCmd.AddCommand(auditSessionRecordingCmd)
	auditCmd.AddCommand(auditGatewaysCmd)
	auditCmd.AddCommand(auditCountriesCmd)
	auditCmd.AddCommand(auditTenantGatewaysCmd)
	auditCmd.AddCommand(auditTenantCountriesCmd)
	auditCmd.AddCommand(auditGeoSummaryCmd)
}

func runAuditList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, auditColumns)
}

func runAuditTenant(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/tenant", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, auditColumns)
}

func runAuditConnection(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/audit/connection/%s", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, auditColumns)
}

func runAuditConnectionUsers(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/audit/connection/%s/users", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "USER_ID", Field: "userId"},
		{Header: "EMAIL", Field: "email"},
		{Header: "LAST_ACCESS", Field: "lastAccess"},
	})
}

func runAuditSessionRecording(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/audit/session/%s/recording", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "SESSION_ID", Field: "sessionId"},
		{Header: "STATUS", Field: "status"},
		{Header: "DURATION", Field: "duration"},
	})
}

func runAuditGateways(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/gateways", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "ID", Field: "id"},
		{Header: "NAME", Field: "name"},
		{Header: "STATUS", Field: "status"},
	})
}

func runAuditCountries(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/countries", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "COUNTRY", Field: "country"},
		{Header: "COUNT", Field: "count"},
	})
}

func runAuditTenantGateways(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/tenant/gateways", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "ID", Field: "id"},
		{Header: "NAME", Field: "name"},
		{Header: "STATUS", Field: "status"},
	})
}

func runAuditTenantCountries(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/tenant/countries", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "COUNTRY", Field: "country"},
		{Header: "COUNT", Field: "count"},
	})
}

func runAuditGeoSummary(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}
	if err := ensureIPGeolocationEnabled(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/audit/tenant/geo-summary", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "COUNTRY", Field: "country"},
		{Header: "CITY", Field: "city"},
		{Header: "COUNT", Field: "count"},
	})
}
