package catalog

import "github.com/dnviti/arsenale/backend/pkg/contracts"

var services = []contracts.ServiceMetadata{
	{Name: contracts.ServiceControlPlaneAPI, Plane: contracts.PlaneControl, Description: "Public control-plane API for tenants, connections, policies, and grants", DefaultPort: 8080, Public: true, Stateless: true, Dependencies: []string{"postgres", "redis", "s3"}},
	{Name: contracts.ServiceControlController, Plane: contracts.PlaneControl, Description: "Reconciliation and placement controller", DefaultPort: 8081, Public: false, Stateless: false, Dependencies: []string{"postgres", "redis"}},
	{Name: contracts.ServiceAuthzPDP, Plane: contracts.PlaneControl, Description: "Central policy decision point for users, services, and agents", DefaultPort: 8082, Public: false, Stateless: true, Dependencies: []string{"postgres", "redis"}},
	{Name: contracts.ServiceModelGateway, Plane: contracts.PlaneAgent, Description: "LLM and embedding provider gateway", DefaultPort: 8083, Public: false, Stateless: true, Dependencies: []string{"postgres", "redis"}},
	{Name: contracts.ServiceToolGateway, Plane: contracts.PlaneAgent, Description: "Typed capability gateway for agent actions", DefaultPort: 8084, Public: false, Stateless: true, Dependencies: []string{"postgres", "redis"}},
	{Name: contracts.ServiceAgentOrchestrator, Plane: contracts.PlaneAgent, Description: "Agent run lifecycle and step scheduling", DefaultPort: 8085, Public: false, Stateless: false, Dependencies: []string{"postgres", "redis", "s3"}},
	{Name: contracts.ServiceMemoryService, Plane: contracts.PlaneAgent, Description: "Distributed working, episodic, semantic, and artifact memory", DefaultPort: 8086, Public: false, Stateless: false, Dependencies: []string{"postgres", "redis", "s3"}},
	{Name: contracts.ServiceTerminalBroker, Plane: contracts.PlaneRuntime, Description: "Browser SSH broker", DefaultPort: 8090, Public: true, Stateless: true, Dependencies: []string{"redis"}},
	{Name: contracts.ServiceDesktopBroker, Plane: contracts.PlaneRuntime, Description: "Browser RDP/VNC broker", DefaultPort: 8091, Public: true, Stateless: true, Dependencies: []string{"redis", "guacd"}},
	{Name: contracts.ServiceTunnelBroker, Plane: contracts.PlaneRuntime, Description: "Tunnel registration, ownership, and stream multiplexing", DefaultPort: 8092, Public: false, Stateless: false, Dependencies: []string{"redis"}},
	{Name: contracts.ServiceQueryRunner, Plane: contracts.PlaneRuntime, Description: "Database session and query execution service", DefaultPort: 8093, Public: false, Stateless: true, Dependencies: []string{"postgres", "redis"}},
	{Name: contracts.ServiceMapAssets, Plane: contracts.PlaneRuntime, Description: "Raster XYZ tile service for IP geolocation maps", DefaultPort: 8096, Public: true, Stateless: true},
	{Name: contracts.ServiceRecordingWorker, Plane: contracts.PlaneRuntime, Description: "Recording conversion and retention worker", DefaultPort: 8094, Public: false, Stateless: false, Dependencies: []string{"postgres", "s3"}},
	{Name: contracts.ServiceRuntimeAgent, Plane: contracts.PlaneExecution, Description: "Host-local Docker/Podman runtime agent", DefaultPort: 8095, Public: false, Stateless: false},
}

var capabilities = []contracts.CapabilityDefinition{
	{ID: "connection.read", Action: "connection.read", ResourceType: "connection", Description: "Read connection metadata", Risk: contracts.CapabilityRiskLow},
	{ID: "connection.connect.ssh", Action: "connection.connect.ssh", ResourceType: "connection", Description: "Create an SSH session grant", Risk: contracts.CapabilityRiskMedium},
	{ID: "connection.connect.rdp", Action: "connection.connect.rdp", ResourceType: "connection", Description: "Create an RDP/VNC session grant", Risk: contracts.CapabilityRiskMedium},
	{ID: "db.schema.read", Action: "db.schema.read", ResourceType: "database", Description: "Inspect database schema metadata", Risk: contracts.CapabilityRiskLow},
	{ID: "db.introspection.read", Action: "db.introspection.read", ResourceType: "database", Description: "Inspect database execution metadata and object details", Risk: contracts.CapabilityRiskLow},
	{ID: "db.query.execute.readonly", Action: "db.query.execute.readonly", ResourceType: "database", Description: "Execute read-only database queries", Risk: contracts.CapabilityRiskMedium},
	{ID: "db.query.execute.write", Action: "db.query.execute.write", ResourceType: "database", Description: "Execute write-capable database queries", Risk: contracts.CapabilityRiskHigh, RequiresApproval: true},
	{ID: "gateway.read", Action: "gateway.read", ResourceType: "gateway", Description: "Read gateway inventory and health", Risk: contracts.CapabilityRiskLow},
	{ID: "gateway.scale", Action: "gateway.scale", ResourceType: "gateway", Description: "Scale gateway workloads", Risk: contracts.CapabilityRiskHigh, RequiresApproval: true},
	{ID: "workload.deploy", Action: "workload.deploy", ResourceType: "workload", Description: "Deploy workloads to configured orchestrators", Risk: contracts.CapabilityRiskCritical, RequiresApproval: true},
	{ID: "memory.read", Action: "memory.read", ResourceType: "memory_namespace", Description: "Read agent memory namespaces", Risk: contracts.CapabilityRiskLow},
	{ID: "memory.write", Action: "memory.write", ResourceType: "memory_namespace", Description: "Write to agent memory namespaces", Risk: contracts.CapabilityRiskMedium},
	{ID: "audit.search", Action: "audit.search", ResourceType: "audit_log", Description: "Search audit activity", Risk: contracts.CapabilityRiskLow},
}

func Services() []contracts.ServiceMetadata {
	out := make([]contracts.ServiceMetadata, len(services))
	copy(out, services)
	return out
}

func MustService(name contracts.ServiceName) contracts.ServiceMetadata {
	for _, svc := range services {
		if svc.Name == name {
			return svc
		}
	}
	panic("unknown service: " + string(name))
}

func Capabilities() []contracts.CapabilityDefinition {
	out := make([]contracts.CapabilityDefinition, len(capabilities))
	copy(out, capabilities)
	return out
}

func Manifest(version string) contracts.ArchitectureManifest {
	return contracts.ArchitectureManifest{
		Version:  version,
		Services: Services(),
		Storage: []contracts.StorageComponent{
			{Name: "postgres", Kind: "database", Purpose: "durable truth, jobs, memory metadata, audit"},
			{Name: "redis", Kind: "cache", Purpose: "leases, locks, working memory, grants, fanout"},
			{Name: "s3", Kind: "object-storage", Purpose: "recordings, artifacts, exported outputs"},
		},
		OrchestratorKinds: []string{
			string(contracts.OrchestratorDocker),
			string(contracts.OrchestratorPodman),
			string(contracts.OrchestratorKubernetes),
		},
		CapabilityFamilies: capabilities,
		SupportedMemoryTypes: []contracts.MemoryType{
			contracts.MemoryWorking,
			contracts.MemoryEpisodic,
			contracts.MemorySemantic,
			contracts.MemoryProcedural,
			contracts.MemoryArtifact,
		},
		SupportedMemoryScopes: []contracts.MemoryScope{
			contracts.MemoryScopeTenant,
			contracts.MemoryScopePrincipal,
			contracts.MemoryScopeAgent,
			contracts.MemoryScopeRun,
			contracts.MemoryScopeWorkflow,
		},
		ExecutionPrincipalKinds: []contracts.PrincipalType{
			contracts.PrincipalUser,
			contracts.PrincipalServiceAccount,
			contracts.PrincipalAgentDef,
			contracts.PrincipalAgentInstance,
			contracts.PrincipalAgentRun,
			contracts.PrincipalSystem,
		},
	}
}
