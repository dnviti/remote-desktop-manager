package cmd

import (
	"encoding/json"
	"fmt"

	"github.com/spf13/cobra"
)

var gwEgressFromFile string
var gwEgressTestProtocol string
var gwEgressTestHost string
var gwEgressTestPort int
var gwEgressTestUserID string

var gwEgressTestColumns = []Column{
	{Header: "ALLOWED", Field: "allowed"},
	{Header: "REASON", Field: "reason"},
	{Header: "RULE", Field: "ruleIndex"},
	{Header: "ACTION", Field: "ruleAction"},
}

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

var gwEgressTestCmd = &cobra.Command{
	Use:   "test <id>",
	Short: "Test a gateway egress policy decision",
	Long:  `Test the saved gateway egress policy or a local JSON/YAML draft with --from-file.`,
	Args:  cobra.ExactArgs(1),
	Run:   runGwEgressTest,
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

func runGwEgressTest(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}
	if gwEgressTestProtocol == "" || gwEgressTestHost == "" || gwEgressTestPort == 0 || gwEgressTestUserID == "" {
		fatal("--protocol, --host, --port, and --user-id are required")
	}
	payload := map[string]any{
		"protocol": gwEgressTestProtocol,
		"host":     gwEgressTestHost,
		"port":     gwEgressTestPort,
		"userId":   gwEgressTestUserID,
	}
	if gwEgressFromFile != "" {
		data, err := readResourceFromFileOrStdin(gwEgressFromFile)
		if err != nil {
			fatal("%v", err)
		}
		var policy any
		if err := json.Unmarshal(data, &policy); err != nil {
			fatal("parse policy: %v", err)
		}
		payload["policy"] = policy
	}
	data, err := json.Marshal(payload)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/egress/test", args[0]), json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, gwEgressTestColumns)
}
