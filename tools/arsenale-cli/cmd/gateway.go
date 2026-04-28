package cmd

import "github.com/spf13/cobra"

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
