package cmd

import (
	"encoding/json"

	"github.com/spf13/cobra"
)

var tabColumns = []Column{
	{Header: "CONNECTION_ID", Field: "connectionId"},
	{Header: "SORT_ORDER", Field: "sortOrder"},
	{Header: "IS_ACTIVE", Field: "isActive"},
}

var tabCmd = &cobra.Command{
	Use:   "tab",
	Short: "Manage persisted tab state",
}

var tabListCmd = &cobra.Command{
	Use:   "list",
	Short: "List persisted tabs",
	Run:   runTabList,
}

var tabSyncCmd = &cobra.Command{
	Use:   "sync",
	Short: "Sync persisted tabs from a JSON or YAML file",
	Run:   runTabSync,
}

var tabClearCmd = &cobra.Command{
	Use:   "clear",
	Short: "Clear all persisted tabs",
	Run:   runTabClear,
}

var tabSyncFromFile string

func init() {
	rootCmd.AddCommand(tabCmd)
	tabCmd.AddCommand(tabListCmd)
	tabCmd.AddCommand(tabSyncCmd)
	tabCmd.AddCommand(tabClearCmd)

	tabSyncCmd.Flags().StringVarP(&tabSyncFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	tabSyncCmd.MarkFlagRequired("from-file")
}

func runTabList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	respBody, status, err := apiGet("/api/tabs", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().Print(respBody, tabColumns); err != nil {
		fatal("%v", err)
	}
}

func runTabSync(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(tabSyncFromFile)
	if err != nil {
		fatal("%v", err)
	}

	var decoded any
	if err := json.Unmarshal(data, &decoded); err != nil {
		fatal("parse tabs payload: %v", err)
	}

	payload := map[string]any{}
	switch value := decoded.(type) {
	case []any:
		payload["tabs"] = value
	case map[string]any:
		if _, ok := value["tabs"]; ok {
			payload = value
		} else {
			fatal("tabs sync input must be an array or an object with a top-level \"tabs\" field")
		}
	default:
		fatal("tabs sync input must be an array or an object with a top-level \"tabs\" field")
	}

	respBody, status, err := apiPut("/api/tabs", payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if err := printer().Print(respBody, tabColumns); err != nil {
		fatal("%v", err)
	}
}

func runTabClear(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	respBody, status, err := apiDelete("/api/tabs", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, respBody)
	if !quiet {
		printer().PrintDeleted("Tabs", "all")
	}
}
