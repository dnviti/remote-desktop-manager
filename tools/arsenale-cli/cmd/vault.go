package cmd

import (
	"encoding/json"
	"fmt"
	"os"

	"github.com/spf13/cobra"
)

var vaultCmd = &cobra.Command{
	Use:   "vault",
	Short: "Manage the vault",
}

var vaultStatusCmd = &cobra.Command{
	Use:   "status",
	Short: "Get vault status",
	Run:   runVaultStatus,
}

var vaultUnlockCmd = &cobra.Command{
	Use:   "unlock",
	Short: "Unlock the vault",
	Run:   runVaultUnlock,
}

var vaultLockCmd = &cobra.Command{
	Use:   "lock",
	Short: "Lock the vault",
	Run:   runVaultLock,
}

var vaultTouchCmd = &cobra.Command{
	Use:   "touch",
	Short: "Refresh the vault activity timeout",
	Run:   runVaultTouch,
}

var vaultAutoLockCmd = &cobra.Command{
	Use:   "auto-lock",
	Short: "Manage auto-lock settings",
}

var vaultAutoLockGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get auto-lock timeout",
	Run:   runVaultAutoLockGet,
}

var vaultAutoLockSetCmd = &cobra.Command{
	Use:   "set",
	Short: "Set auto-lock timeout",
	Run:   runVaultAutoLockSet,
}

var vaultRecoveryStatusCmd = &cobra.Command{
	Use:   "recovery-status",
	Short: "Get vault recovery status",
	Run:   runVaultRecoveryStatus,
}

var vaultRevealPasswordCmd = &cobra.Command{
	Use:   "reveal-password",
	Short: "Reveal a secret password (raw output for piping)",
	Run:   runVaultRevealPassword,
}

var vaultTenantStatusCmd = &cobra.Command{
	Use:   "tenant-status",
	Short: "Get tenant vault status",
	Run:   runVaultTenantStatus,
}

var vaultTenantInitCmd = &cobra.Command{
	Use:   "tenant-init",
	Short: "Initialize tenant vault",
	Run:   runVaultTenantInit,
}

var vaultTenantDistributeCmd = &cobra.Command{
	Use:   "tenant-distribute",
	Short: "Distribute tenant vault keys",
	Run:   runVaultTenantDistribute,
}

var (
	vaultAutoLockTimeout int
	vaultRevealSecretID  string
	vaultTenantFromFile  string
)

func init() {
	rootCmd.AddCommand(vaultCmd)

	vaultCmd.AddCommand(vaultStatusCmd)
	vaultCmd.AddCommand(vaultUnlockCmd)
	vaultCmd.AddCommand(vaultLockCmd)
	vaultCmd.AddCommand(vaultTouchCmd)
	vaultCmd.AddCommand(vaultAutoLockCmd)
	vaultCmd.AddCommand(vaultRecoveryStatusCmd)
	vaultCmd.AddCommand(vaultRevealPasswordCmd)
	vaultCmd.AddCommand(vaultTenantStatusCmd)
	vaultCmd.AddCommand(vaultTenantInitCmd)
	vaultCmd.AddCommand(vaultTenantDistributeCmd)

	vaultAutoLockCmd.AddCommand(vaultAutoLockGetCmd)
	vaultAutoLockCmd.AddCommand(vaultAutoLockSetCmd)

	vaultAutoLockSetCmd.Flags().IntVar(&vaultAutoLockTimeout, "timeout", 0, "Auto-lock timeout in seconds")
	vaultAutoLockSetCmd.MarkFlagRequired("timeout")

	vaultRevealPasswordCmd.Flags().StringVar(&vaultRevealSecretID, "secret-id", "", "Secret ID to reveal")
	vaultRevealPasswordCmd.MarkFlagRequired("secret-id")

	vaultTenantInitCmd.Flags().StringVarP(&vaultTenantFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	vaultTenantInitCmd.MarkFlagRequired("from-file")

	vaultTenantDistributeCmd.Flags().StringVarP(&vaultTenantFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	vaultTenantDistributeCmd.MarkFlagRequired("from-file")
}

func runVaultStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/vault/status", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "STATUS", Field: "status"},
		{Header: "LOCKED", Field: "locked"},
	})
}

func runVaultUnlock(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	pw, err := promptPassword("Vault password: ")
	if err != nil {
		fatal("read password: %v", err)
	}

	payload := map[string]string{
		"password": pw,
	}

	body, status, err := apiPost("/api/vault/unlock", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Vault unlocked")
}

func runVaultLock(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/vault/lock", nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Vault locked")
}

func runVaultTouch(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/vault/touch", nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "UNLOCKED", Field: "unlocked"},
	})
}

func runVaultAutoLockGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/vault/auto-lock", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "TIMEOUT", Field: "timeout"},
	})
}

func runVaultAutoLockSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]interface{}{
		"timeout": vaultAutoLockTimeout,
	}

	body, status, err := apiPut("/api/vault/auto-lock", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Auto-lock timeout updated")
}

func runVaultRecoveryStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/vault/recovery-status", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "STATUS", Field: "status"},
		{Header: "AVAILABLE", Field: "available"},
	})
}

func runVaultRevealPassword(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]string{
		"secretId": vaultRevealSecretID,
	}

	body, status, err := apiPost("/api/vault/reveal-password", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	// Output raw password only, no decoration (for piping)
	var result struct {
		Password string `json:"password"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		fatal("parse response: %v", err)
	}
	fmt.Fprint(os.Stdout, result.Password)
}

func runVaultTenantStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/secrets/tenant-vault/status", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "STATUS", Field: "status"},
		{Header: "INITIALIZED", Field: "initialized"},
	})
}

func runVaultTenantInit(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(vaultTenantFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/secrets/tenant-vault/init", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Tenant vault initialized")
}

func runVaultTenantDistribute(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(vaultTenantFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/secrets/tenant-vault/distribute", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	fmt.Println("Tenant vault keys distributed")
}
