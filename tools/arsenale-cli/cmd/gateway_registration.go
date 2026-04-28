package cmd

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
	gwEgressCmd.AddCommand(gwEgressTestCmd)

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
	gwEgressTestCmd.Flags().StringVar(&gwEgressTestProtocol, "protocol", "", "Protocol to test (SSH, RDP, VNC, DATABASE)")
	gwEgressTestCmd.Flags().StringVar(&gwEgressTestHost, "host", "", "Destination host to test")
	gwEgressTestCmd.Flags().IntVar(&gwEgressTestPort, "port", 0, "Destination port to test")
	gwEgressTestCmd.Flags().StringVar(&gwEgressTestUserID, "user-id", "", "Tenant user ID to evaluate")
	gwEgressTestCmd.Flags().StringVarP(&gwEgressFromFile, "from-file", "f", "", "Optional JSON/YAML draft policy (- for stdin)")

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
