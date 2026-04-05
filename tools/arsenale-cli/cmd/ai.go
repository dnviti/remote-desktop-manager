package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var aiCmd = &cobra.Command{
	Use:   "ai",
	Short: "Manage and use AI features",
}

var aiConfigCmd = &cobra.Command{
	Use:   "config",
	Short: "Manage AI configuration",
}

var aiConfigGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get AI configuration",
	Run:   runAiConfigGet,
}

var aiConfigSetCmd = &cobra.Command{
	Use:   "set",
	Short: "Set AI configuration",
	Long:  `Set AI configuration from a JSON/YAML file: arsenale ai config set --from-file config.yaml`,
	Run:   runAiConfigSet,
}

var aiConfigFromFile string

func init() {
	rootCmd.AddCommand(aiCmd)

	aiCmd.AddCommand(aiConfigCmd)
	aiConfigCmd.AddCommand(aiConfigGetCmd)
	aiConfigCmd.AddCommand(aiConfigSetCmd)

	aiConfigSetCmd.Flags().StringVarP(&aiConfigFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	aiConfigSetCmd.MarkFlagRequired("from-file")
}

func runAiConfigGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/ai/config", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "PROVIDER", Field: "provider"},
		{Header: "MODEL", Field: "modelId"},
		{Header: "ENABLED", Field: "enabled"},
	})
}

func runAiConfigSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(aiConfigFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut("/api/ai/config", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	if !quiet {
		fmt.Println("AI configuration updated")
	}
}
