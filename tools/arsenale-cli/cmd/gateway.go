package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/spf13/cobra"
)

var gatewayColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "NAME", Field: "name"},
	{Header: "TYPE", Field: "type"},
	{Header: "STATUS", Field: "operationalStatus"},
	{Header: "HEALTHY", Field: "healthyInstances"},
	{Header: "RUNNING", Field: "runningInstances"},
	{Header: "DESIRED", Field: "desiredReplicas"},
}

var gatewayInstanceColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "STATUS", Field: "status"},
	{Header: "HEALTH", Field: "healthStatus"},
	{Header: "HOST", Field: "host"},
	{Header: "PORT", Field: "port"},
	{Header: "CONTAINER", Field: "containerName"},
}

var gatewayStatusColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "NAME", Field: "name"},
	{Header: "TYPE", Field: "type"},
	{Header: "STATUS", Field: "operationalStatus"},
	{Header: "HEALTHY", Field: "healthyInstances"},
	{Header: "RUNNING", Field: "runningInstances"},
	{Header: "DESIRED", Field: "desiredReplicas"},
	{Header: "TUNNEL", Field: "tunnelConnected"},
	{Header: "DETAIL", Field: "operationalReason"},
}

var gatewayTemplateColumns = []Column{
	{Header: "ID", Field: "id"},
	{Header: "NAME", Field: "name"},
	{Header: "TYPE", Field: "type"},
}

// ---------------------------------------------------------------------------
// Top-level: arsenale gateway
// ---------------------------------------------------------------------------

var gatewayCmd = &cobra.Command{
	Use:     "gateway",
	Aliases: []string{"gw"},
	Short:   "Manage gateways",
}

// ---------------------------------------------------------------------------
// Basic CRUD
// ---------------------------------------------------------------------------

var gwListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all gateways",
	Run:   runGwList,
}

var gwCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new gateway",
	Long:  `Create a gateway from a JSON/YAML file: arsenale gateway create --from-file gw.yaml`,
	Run:   runGwCreate,
}

var gwUpdateCmd = &cobra.Command{
	Use:   "update <id>",
	Short: "Update a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwUpdate,
}

var gwDeleteCmd = &cobra.Command{
	Use:   "delete <id>",
	Short: "Delete a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwDelete,
}

// ---------------------------------------------------------------------------
// Operations
// ---------------------------------------------------------------------------

var gwDeployCmd = &cobra.Command{
	Use:   "deploy <id>",
	Short: "Deploy a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwDeploy,
}

var gwStatusCmd = &cobra.Command{
	Use:   "status <id>",
	Short: "Show gateway status and instances",
	Args:  cobra.ExactArgs(1),
	Run:   runGwStatus,
}

var gwUndeployCmd = &cobra.Command{
	Use:   "undeploy <id>",
	Short: "Undeploy a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwUndeploy,
}

var gwScaleCmd = &cobra.Command{
	Use:   "scale <id>",
	Short: "Scale a gateway",
	Long:  `Scale a gateway: arsenale gateway scale <id> --replicas 3`,
	Args:  cobra.ExactArgs(1),
	Run:   runGwScale,
}

var gwTestCmd = &cobra.Command{
	Use:   "test <id>",
	Short: "Test a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTest,
}

var gwPushKeyCmd = &cobra.Command{
	Use:   "push-key <id>",
	Short: "Push SSH key to a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwPushKey,
}

// ---------------------------------------------------------------------------
// Scaling subcommand group
// ---------------------------------------------------------------------------

var gwScalingCmd = &cobra.Command{
	Use:   "scaling",
	Short: "Manage gateway scaling configuration",
}

var gwScalingGetCmd = &cobra.Command{
	Use:   "get <id>",
	Short: "Get scaling configuration for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwScalingGet,
}

var gwScalingSetCmd = &cobra.Command{
	Use:   "set <id>",
	Short: "Set scaling configuration for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwScalingSet,
}

// ---------------------------------------------------------------------------
// Instances
// ---------------------------------------------------------------------------

var gwInstancesCmd = &cobra.Command{
	Use:   "instances <id>",
	Short: "List instances for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwInstances,
}

var gwInstanceCmd = &cobra.Command{
	Use:   "instance",
	Short: "Manage gateway instances",
}

var gwInstanceRestartCmd = &cobra.Command{
	Use:   "restart <gatewayId> <instanceId>",
	Short: "Restart a gateway instance",
	Args:  cobra.ExactArgs(2),
	Run:   runGwInstanceRestart,
}

var gwInstanceLogsCmd = &cobra.Command{
	Use:   "logs <gatewayId> <instanceId>",
	Short: "Get logs for a gateway instance",
	Args:  cobra.ExactArgs(2),
	Run:   runGwInstanceLogs,
}

var gwLogsCmd = &cobra.Command{
	Use:   "logs <gatewayId>",
	Short: "Get logs for a gateway's latest or selected instance",
	Args:  cobra.ExactArgs(1),
	Run:   runGwLogs,
}

// ---------------------------------------------------------------------------
// Tunnel subcommands
// ---------------------------------------------------------------------------

var gwTunnelTokenCmd = &cobra.Command{
	Use:   "tunnel-token",
	Short: "Manage tunnel tokens",
}

var gwTunnelTokenCreateCmd = &cobra.Command{
	Use:   "create <id>",
	Short: "Create a tunnel token for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTunnelTokenCreate,
}

var gwTunnelTokenRevokeCmd = &cobra.Command{
	Use:   "revoke <id>",
	Short: "Revoke a tunnel token for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTunnelTokenRevoke,
}

var gwTunnelDisconnectCmd = &cobra.Command{
	Use:   "tunnel-disconnect <id>",
	Short: "Disconnect tunnel for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTunnelDisconnect,
}

var gwTunnelEventsCmd = &cobra.Command{
	Use:   "tunnel-events <id>",
	Short: "Get tunnel events for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTunnelEvents,
}

var gwTunnelMetricsCmd = &cobra.Command{
	Use:   "tunnel-metrics <id>",
	Short: "Get tunnel metrics for a gateway",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTunnelMetrics,
}

var gwTunnelOverviewCmd = &cobra.Command{
	Use:   "tunnel-overview",
	Short: "Get tunnel overview across all gateways",
	Run:   runGwTunnelOverview,
}

// ---------------------------------------------------------------------------
// SSH Keypair subcommand group
// ---------------------------------------------------------------------------

var gwSSHKeypairCmd = &cobra.Command{
	Use:   "ssh-keypair",
	Short: "Manage SSH keypairs",
}

var gwSSHKeypairGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get the current SSH keypair",
	Run:   runGwSSHKeypairGet,
}

var gwSSHKeypairGenerateCmd = &cobra.Command{
	Use:   "generate",
	Short: "Generate a new SSH keypair",
	Run:   runGwSSHKeypairGenerate,
}

var gwSSHKeypairDownloadCmd = &cobra.Command{
	Use:   "download",
	Short: "Download the private SSH key",
	Long:  `Download the private SSH key: arsenale gateway ssh-keypair download --dest /path/to/key`,
	Run:   runGwSSHKeypairDownload,
}

var gwSSHKeypairRotateCmd = &cobra.Command{
	Use:   "rotate",
	Short: "Rotate the SSH keypair",
	Run:   runGwSSHKeypairRotate,
}

var gwSSHKeypairRotationPolicyCmd = &cobra.Command{
	Use:   "rotation-policy",
	Short: "Manage SSH keypair rotation policy",
}

var gwSSHKeypairRotationPolicyGetCmd = &cobra.Command{
	Use:   "get",
	Short: "Get the SSH keypair rotation policy",
	Run:   runGwSSHKeypairRotationPolicyGet,
}

var gwSSHKeypairRotationPolicySetCmd = &cobra.Command{
	Use:   "set",
	Short: "Set the SSH keypair rotation policy",
	Long:  `Set rotation policy from a JSON/YAML file: arsenale gateway ssh-keypair rotation-policy set --from-file policy.yaml`,
	Run:   runGwSSHKeypairRotationPolicySet,
}

// ---------------------------------------------------------------------------
// Template subcommand group
// ---------------------------------------------------------------------------

var gwTemplateCmd = &cobra.Command{
	Use:   "template",
	Short: "Manage gateway templates",
}

var gwTemplateListCmd = &cobra.Command{
	Use:   "list",
	Short: "List all gateway templates",
	Run:   runGwTemplateList,
}

var gwTemplateCreateCmd = &cobra.Command{
	Use:   "create",
	Short: "Create a new gateway template",
	Long:  `Create a template from a JSON/YAML file: arsenale gateway template create --from-file tmpl.yaml`,
	Run:   runGwTemplateCreate,
}

var gwTemplateUpdateCmd = &cobra.Command{
	Use:   "update <templateId>",
	Short: "Update a gateway template",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTemplateUpdate,
}

var gwTemplateDeleteCmd = &cobra.Command{
	Use:   "delete <templateId>",
	Short: "Delete a gateway template",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTemplateDelete,
}

var gwTemplateDeployCmd = &cobra.Command{
	Use:   "deploy <templateId>",
	Short: "Deploy a gateway template",
	Args:  cobra.ExactArgs(1),
	Run:   runGwTemplateDeploy,
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

var (
	gwFromFile         string
	gwScaleReplicas    int
	gwSSHKeypairDest   string
	gwTemplateFromFile string
	gwScalingFromFile  string
	gwRotationFromFile string
	gwLogInstanceID    string
	gwLogTailLines     int
)

// ---------------------------------------------------------------------------
// init — register everything
// ---------------------------------------------------------------------------

func init() {
	rootCmd.AddCommand(gatewayCmd)

	// Basic CRUD
	gatewayCmd.AddCommand(gwListCmd)
	gatewayCmd.AddCommand(gwCreateCmd)
	gatewayCmd.AddCommand(gwUpdateCmd)
	gatewayCmd.AddCommand(gwDeleteCmd)

	// Operations
	gatewayCmd.AddCommand(gwDeployCmd)
	gatewayCmd.AddCommand(gwStatusCmd)
	gatewayCmd.AddCommand(gwUndeployCmd)
	gatewayCmd.AddCommand(gwScaleCmd)
	gatewayCmd.AddCommand(gwTestCmd)
	gatewayCmd.AddCommand(gwPushKeyCmd)
	gatewayCmd.AddCommand(gwLogsCmd)

	// Scaling subcommand group
	gatewayCmd.AddCommand(gwScalingCmd)
	gwScalingCmd.AddCommand(gwScalingGetCmd)
	gwScalingCmd.AddCommand(gwScalingSetCmd)

	// Egress policy
	gatewayCmd.AddCommand(gwEgressCmd)
	gwEgressCmd.AddCommand(gwEgressShowCmd)
	gwEgressCmd.AddCommand(gwEgressSetCmd)

	// Instances
	gatewayCmd.AddCommand(gwInstancesCmd)
	gatewayCmd.AddCommand(gwInstanceCmd)
	gwInstanceCmd.AddCommand(gwInstanceRestartCmd)
	gwInstanceCmd.AddCommand(gwInstanceLogsCmd)

	// Tunnel
	gatewayCmd.AddCommand(gwTunnelTokenCmd)
	gwTunnelTokenCmd.AddCommand(gwTunnelTokenCreateCmd)
	gwTunnelTokenCmd.AddCommand(gwTunnelTokenRevokeCmd)
	gatewayCmd.AddCommand(gwTunnelDisconnectCmd)
	gatewayCmd.AddCommand(gwTunnelEventsCmd)
	gatewayCmd.AddCommand(gwTunnelMetricsCmd)
	gatewayCmd.AddCommand(gwTunnelOverviewCmd)

	// SSH Keypair
	gatewayCmd.AddCommand(gwSSHKeypairCmd)
	gwSSHKeypairCmd.AddCommand(gwSSHKeypairGetCmd)
	gwSSHKeypairCmd.AddCommand(gwSSHKeypairGenerateCmd)
	gwSSHKeypairCmd.AddCommand(gwSSHKeypairDownloadCmd)
	gwSSHKeypairCmd.AddCommand(gwSSHKeypairRotateCmd)
	gwSSHKeypairCmd.AddCommand(gwSSHKeypairRotationPolicyCmd)
	gwSSHKeypairRotationPolicyCmd.AddCommand(gwSSHKeypairRotationPolicyGetCmd)
	gwSSHKeypairRotationPolicyCmd.AddCommand(gwSSHKeypairRotationPolicySetCmd)

	// Templates
	gatewayCmd.AddCommand(gwTemplateCmd)
	gwTemplateCmd.AddCommand(gwTemplateListCmd)
	gwTemplateCmd.AddCommand(gwTemplateCreateCmd)
	gwTemplateCmd.AddCommand(gwTemplateUpdateCmd)
	gwTemplateCmd.AddCommand(gwTemplateDeleteCmd)
	gwTemplateCmd.AddCommand(gwTemplateDeployCmd)

	// Flags
	gwCreateCmd.Flags().StringVarP(&gwFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwCreateCmd.MarkFlagRequired("from-file")
	gwUpdateCmd.Flags().StringVarP(&gwFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwUpdateCmd.MarkFlagRequired("from-file")

	gwScaleCmd.Flags().IntVar(&gwScaleReplicas, "replicas", 1, "Number of replicas")
	gwScaleCmd.MarkFlagRequired("replicas")

	gwScalingSetCmd.Flags().StringVarP(&gwScalingFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwScalingSetCmd.MarkFlagRequired("from-file")

	gwEgressSetCmd.Flags().StringVarP(&gwEgressFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwEgressSetCmd.MarkFlagRequired("from-file")

	gwSSHKeypairDownloadCmd.Flags().StringVar(&gwSSHKeypairDest, "dest", ".", "Destination directory for private key")

	gwSSHKeypairRotationPolicySetCmd.Flags().StringVarP(&gwRotationFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwSSHKeypairRotationPolicySetCmd.MarkFlagRequired("from-file")

	gwTemplateCreateCmd.Flags().StringVarP(&gwTemplateFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwTemplateCreateCmd.MarkFlagRequired("from-file")
	gwTemplateUpdateCmd.Flags().StringVarP(&gwTemplateFromFile, "from-file", "f", "", "JSON/YAML file (- for stdin)")
	gwTemplateUpdateCmd.MarkFlagRequired("from-file")

	gwLogsCmd.Flags().StringVar(&gwLogInstanceID, "instance", "", "Specific managed gateway instance ID")
	gwLogsCmd.Flags().IntVar(&gwLogTailLines, "tail", 0, "Number of log lines to fetch")
	gwInstanceLogsCmd.Flags().IntVar(&gwLogTailLines, "tail", 0, "Number of log lines to fetch")
}

// ===========================================================================
// Run functions — Basic CRUD
// ===========================================================================

func runGwList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/gateways", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, gatewayColumns)
}

func runGwCreate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/gateways", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "id")
}

func runGwUpdate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut("/api/gateways/"+args[0], json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, gatewayColumns)
}

func runGwDelete(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete("/api/gateways/"+args[0], cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintDeleted("Gateway", args[0])
}

// ===========================================================================
// Run functions — Operations
// ===========================================================================

func runGwDeploy(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/deploy", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Gateway %q deployed\n", args[0])
	}
}

func runGwStatus(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	gateway, err := getGatewayByID(cfg, args[0])
	if err != nil {
		fatal("%v", err)
	}
	instances, err := getGatewayInstances(cfg, args[0])
	if err != nil {
		fatal("%v", err)
	}

	combined := map[string]any{
		"gateway":   gateway,
		"instances": instances,
	}
	combinedJSON, err := json.Marshal(combined)
	if err != nil {
		fatal("marshal gateway status: %v", err)
	}

	if outputFormat == "json" || outputFormat == "yaml" {
		if err := printer().PrintSingle(combinedJSON, nil); err != nil {
			fatal("%v", err)
		}
		return
	}

	fmt.Fprintln(os.Stdout, "Gateway")
	if err := printer().PrintSingle(mustMarshalJSON(gateway), gatewayStatusColumns); err != nil {
		fatal("%v", err)
	}
	fmt.Fprintln(os.Stdout)
	fmt.Fprintln(os.Stdout, "Instances")
	if len(instances) == 0 {
		fmt.Fprintln(os.Stdout, "(none)")
		return
	}
	if err := printer().Print(mustMarshalJSON(instances), gatewayInstanceColumns); err != nil {
		fatal("%v", err)
	}
}

func runGwUndeploy(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete(fmt.Sprintf("/api/gateways/%s/deploy", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Gateway %q undeployed\n", args[0])
	}
}

func runGwScale(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	payload := map[string]interface{}{
		"replicas": gwScaleReplicas,
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/scale", args[0]), payload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Gateway %q scaled to %d replicas\n", args[0], gwScaleReplicas)
	}
}

func runGwTest(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/test", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "REACHABLE", Field: "reachable"},
		{Header: "LATENCY_MS", Field: "latencyMs"},
		{Header: "ERROR", Field: "error"},
	})
}

func runGwPushKey(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/push-key", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("SSH key pushed to gateway %q\n", args[0])
	}
}

// ===========================================================================
// Run functions — Scaling
// ===========================================================================

func runGwScalingGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/scaling", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "MIN_REPLICAS", Field: "minReplicas"},
		{Header: "MAX_REPLICAS", Field: "maxReplicas"},
		{Header: "CURRENT", Field: "currentReplicas"},
	})
}

func runGwScalingSet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwScalingFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut(fmt.Sprintf("/api/gateways/%s/scaling", args[0]), json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Scaling configuration updated for gateway %q\n", args[0])
	}
}

// ===========================================================================
// Run functions — Instances
// ===========================================================================

func runGwInstances(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/instances", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, gatewayInstanceColumns)
}

func runGwInstanceRestart(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/instances/%s/restart", args[0], args[1]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Instance %q restarted on gateway %q\n", args[1], args[0])
	}
}

func runGwInstanceLogs(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(buildGatewayLogsPath(args[0], args[1]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printGatewayLogs(body)
}

func runGwLogs(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	instances, err := getGatewayInstances(cfg, args[0])
	if err != nil {
		fatal("%v", err)
	}
	instance, err := selectGatewayInstance(instances, gwLogInstanceID)
	if err != nil {
		fatal("%v", err)
	}

	instanceID := strings.TrimSpace(formatValue(instance["id"]))
	if !quiet && gwLogInstanceID == "" {
		fmt.Fprintf(os.Stderr, "Using instance %s (%s)\n", instanceID, formatValue(instance["containerName"]))
	}
	body, status, err := apiGet(buildGatewayLogsPath(args[0], instanceID), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printGatewayLogs(body)
}

// ===========================================================================
// Run functions — Tunnels
// ===========================================================================

func runGwTunnelTokenCreate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/tunnel-token", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "token")
}

func runGwTunnelTokenRevoke(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete(fmt.Sprintf("/api/gateways/%s/tunnel-token", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Tunnel token revoked for gateway %q\n", args[0])
	}
}

func runGwTunnelDisconnect(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/%s/tunnel-disconnect", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Printf("Tunnel disconnected for gateway %q\n", args[0])
	}
}

func runGwTunnelEvents(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/tunnel-events", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "TIMESTAMP", Field: "timestamp"},
		{Header: "EVENT", Field: "event"},
		{Header: "DETAILS", Field: "details"},
	})
}

func runGwTunnelMetrics(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/tunnel-metrics", args[0]), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "CONNECTED", Field: "connected"},
		{Header: "BYTES_IN", Field: "bytesIn"},
		{Header: "BYTES_OUT", Field: "bytesOut"},
		{Header: "UPTIME", Field: "uptime"},
	})
}

func runGwTunnelOverview(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/gateways/tunnel-overview", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, []Column{
		{Header: "GATEWAY_ID", Field: "gatewayId"},
		{Header: "GATEWAY_NAME", Field: "gatewayName"},
		{Header: "CONNECTED", Field: "connected"},
		{Header: "STATUS", Field: "status"},
	})
}

// ===========================================================================
// Run functions — SSH Keypair
// ===========================================================================

func runGwSSHKeypairGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/gateways/ssh-keypair", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "FINGERPRINT", Field: "fingerprint"},
		{Header: "ALGORITHM", Field: "algorithm"},
		{Header: "CREATED_AT", Field: "createdAt"},
	})
}

func runGwSSHKeypairGenerate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/gateways/ssh-keypair", nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "fingerprint")
}

func runGwSSHKeypairDownload(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	destPath := filepath.Join(gwSSHKeypairDest, "id_arsenale")

	status, err := apiDownload("/api/gateways/ssh-keypair/private", destPath, cfg)
	if err != nil {
		fatal("%v", err)
	}
	if status != 200 {
		fatal("download failed (HTTP %d)", status)
	}

	if !quiet {
		fmt.Printf("SSH private key downloaded to %s\n", destPath)
	}
}

func runGwSSHKeypairRotate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/gateways/ssh-keypair/rotate", nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Println("SSH keypair rotated")
	}
}

func runGwSSHKeypairRotationPolicyGet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/gateways/ssh-keypair/rotation", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, []Column{
		{Header: "ENABLED", Field: "enabled"},
		{Header: "INTERVAL_DAYS", Field: "intervalDays"},
		{Header: "LAST_ROTATION", Field: "lastRotation"},
	})
}

func runGwSSHKeypairRotationPolicySet(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwRotationFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPatch("/api/gateways/ssh-keypair/rotation", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if !quiet {
		fmt.Println("SSH keypair rotation policy updated")
	}
}

// ===========================================================================
// Run functions — Templates
// ===========================================================================

func runGwTemplateList(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiGet("/api/gateways/templates", cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().Print(body, gatewayTemplateColumns)
}

func runGwTemplateCreate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwTemplateFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost("/api/gateways/templates", json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintCreated(body, "id")
}

func runGwTemplateUpdate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	data, err := readResourceFromFileOrStdin(gwTemplateFromFile)
	if err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPut("/api/gateways/templates/"+args[0], json.RawMessage(data), cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintSingle(body, gatewayTemplateColumns)
}

func runGwTemplateDelete(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiDelete("/api/gateways/templates/"+args[0], cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	printer().PrintDeleted("Template", args[0])
}

func runGwTemplateDeploy(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	body, status, err := apiPost(fmt.Sprintf("/api/gateways/templates/%s/deploy", args[0]), nil, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)
	if quiet {
		if err := printer().PrintCreated(body, "id"); err != nil {
			fatal("%v", err)
		}
		return
	}
	if err := printer().PrintSingle(body, gatewayColumns); err != nil {
		fatal("%v", err)
	}
}

func getGatewayByID(cfg *CLIConfig, gatewayID string) (map[string]any, error) {
	body, status, err := apiGet("/api/gateways", cfg)
	if err != nil {
		return nil, err
	}
	checkAPIError(status, body)

	var gateways []map[string]any
	if err := json.Unmarshal(body, &gateways); err != nil {
		return nil, fmt.Errorf("parse gateway list: %w", err)
	}
	for _, gateway := range gateways {
		if strings.TrimSpace(formatValue(gateway["id"])) == gatewayID {
			return gateway, nil
		}
	}
	return nil, fmt.Errorf("gateway %q not found", gatewayID)
}

func getGatewayInstances(cfg *CLIConfig, gatewayID string) ([]map[string]any, error) {
	body, status, err := apiGet(fmt.Sprintf("/api/gateways/%s/instances", gatewayID), cfg)
	if err != nil {
		return nil, err
	}
	checkAPIError(status, body)

	var instances []map[string]any
	if err := json.Unmarshal(body, &instances); err != nil {
		return nil, fmt.Errorf("parse gateway instances: %w", err)
	}
	return instances, nil
}

func selectGatewayInstance(instances []map[string]any, wantedID string) (map[string]any, error) {
	if len(instances) == 0 {
		return nil, fmt.Errorf("gateway has no managed instances")
	}
	if wantedID != "" {
		for _, instance := range instances {
			if strings.TrimSpace(formatValue(instance["id"])) == wantedID {
				return instance, nil
			}
		}
		return nil, fmt.Errorf("gateway instance %q not found", wantedID)
	}

	best := instances[0]
	for _, candidate := range instances[1:] {
		if compareGatewayInstances(candidate, best) > 0 {
			best = candidate
		}
	}
	return best, nil
}

func compareGatewayInstances(a, b map[string]any) int {
	if rankA, rankB := gatewayInstanceRank(a), gatewayInstanceRank(b); rankA != rankB {
		if rankA > rankB {
			return 1
		}
		return -1
	}

	timeA := gatewayInstanceTimestamp(a)
	timeB := gatewayInstanceTimestamp(b)
	if timeA.After(timeB) {
		return 1
	}
	if timeB.After(timeA) {
		return -1
	}
	return 0
}

func gatewayInstanceRank(instance map[string]any) int {
	status := strings.ToUpper(strings.TrimSpace(formatValue(instance["status"])))
	health := strings.ToLower(strings.TrimSpace(formatValue(instance["healthStatus"])))

	switch {
	case status == "RUNNING" && health == "healthy":
		return 3
	case status == "RUNNING":
		return 2
	case health == "healthy":
		return 1
	default:
		return 0
	}
}

func gatewayInstanceTimestamp(instance map[string]any) time.Time {
	for _, field := range []string{"updatedAt", "createdAt", "lastHealthCheck"} {
		raw := strings.TrimSpace(formatValue(instance[field]))
		if raw == "" {
			continue
		}
		ts, err := time.Parse(time.RFC3339, raw)
		if err == nil {
			return ts
		}
	}
	return time.Time{}
}

func buildGatewayLogsPath(gatewayID, instanceID string) string {
	path := fmt.Sprintf("/api/gateways/%s/instances/%s/logs", gatewayID, instanceID)
	if gwLogTailLines > 0 {
		path = fmt.Sprintf("%s?tail=%d", path, gwLogTailLines)
	}
	return path
}

func printGatewayLogs(body []byte) {
	if outputFormat == "json" || outputFormat == "yaml" {
		if err := printer().PrintSingle(body, nil); err != nil {
			fatal("%v", err)
		}
		return
	}

	var payload struct {
		Logs string `json:"logs"`
	}
	if err := json.Unmarshal(body, &payload); err != nil || payload.Logs == "" {
		fmt.Println(string(body))
		return
	}
	fmt.Print(payload.Logs)
}

func mustMarshalJSON(value any) []byte {
	data, err := json.Marshal(value)
	if err != nil {
		fatal("marshal output: %v", err)
	}
	return data
}
