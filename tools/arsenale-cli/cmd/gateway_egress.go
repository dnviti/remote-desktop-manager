package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var gwEgressFromFile string

var gwEgressCmd = &cobra.Command{
	Use:   "egress",
	Short: "Manage gateway egress policies",
}

var gwEgressShowCmd = &cobra.Command{
	Use:   "show <id>",
	Short: "Show gateway egress policy",
	Args:  cobra.ExactArgs(1),
	Run:   runGwEgressShow,
}

var gwEgressSetCmd = &cobra.Command{
	Use:   "set <id>",
	Short: "Set gateway egress policy",
	Long:  `Set gateway egress policy from a JSON/YAML file: arsenale gateway egress set <id> --from-file policy.yaml`,
	Args:  cobra.ExactArgs(1),
	Run:   runGwEgressSet,
}

func runGwEgressShow(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/egress", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if outputFormat == "table" {
		if err := printer().printJSON(body); err != nil {
			fatal("%v", err)
		}
		return
	}
	printer().PrintSingle(body, nil)
}

func runGwEgressSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwEgressFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut(fmt.Sprintf("/api/gateways/%s/egress", args[0]), json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, gatewayColumns)
}
