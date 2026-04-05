package contracts

type PlaneName string

const (
	PlaneControl   PlaneName = "control"
	PlaneAgent     PlaneName = "agent"
	PlaneRuntime   PlaneName = "runtime"
	PlaneExecution PlaneName = "execution"
)

type ServiceName string

const (
	ServiceControlPlaneAPI   ServiceName = "control-plane-api"
	ServiceControlController ServiceName = "control-plane-controller"
	ServiceAuthzPDP          ServiceName = "authz-pdp"
	ServiceModelGateway      ServiceName = "model-gateway"
	ServiceToolGateway       ServiceName = "tool-gateway"
	ServiceAgentOrchestrator ServiceName = "agent-orchestrator"
	ServiceMemoryService     ServiceName = "memory-service"
	ServiceTerminalBroker    ServiceName = "terminal-broker"
	ServiceDesktopBroker     ServiceName = "desktop-broker"
	ServiceTunnelBroker      ServiceName = "tunnel-broker"
	ServiceQueryRunner       ServiceName = "query-runner"
	ServiceMapAssets         ServiceName = "map-assets"
	ServiceRecordingWorker   ServiceName = "recording-worker"
	ServiceRuntimeAgent      ServiceName = "runtime-agent"
)

type ServiceMetadata struct {
	Name         ServiceName `json:"name"`
	Plane        PlaneName   `json:"plane"`
	Description  string      `json:"description"`
	DefaultPort  int         `json:"defaultPort"`
	Public       bool        `json:"public"`
	Stateless    bool        `json:"stateless"`
	Dependencies []string    `json:"dependencies,omitempty"`
}

type StorageComponent struct {
	Name    string `json:"name"`
	Kind    string `json:"kind"`
	Purpose string `json:"purpose"`
}

type ArchitectureManifest struct {
	Version                 string                 `json:"version"`
	Services                []ServiceMetadata      `json:"services"`
	Storage                 []StorageComponent     `json:"storage"`
	OrchestratorKinds       []string               `json:"orchestratorKinds"`
	CapabilityFamilies      []CapabilityDefinition `json:"capabilityFamilies"`
	SupportedMemoryTypes    []MemoryType           `json:"supportedMemoryTypes"`
	SupportedMemoryScopes   []MemoryScope          `json:"supportedMemoryScopes"`
	ExecutionPrincipalKinds []PrincipalType        `json:"executionPrincipalKinds"`
}
