package gateways

import "net/http"

const (
	defaultEdgeNetwork    = "arsenale-net-edge"
	defaultDBNetwork      = "arsenale-net-db"
	defaultGuacdNetwork   = "arsenale-net-guacd"
	defaultGatewayNetwork = "arsenale-net-gateway"

	localSSHGatewayImage  = "localhost/arsenale_ssh-gateway:latest"
	localGuacdImage       = "localhost/arsenale_guacd:latest"
	localDBProxyImage     = "localhost/arsenale_db-proxy:latest"
	localDevDBProxyImage  = "localhost/arsenale_dev-tunnel-db-proxy:latest"
	remoteSSHGatewayImage = "ghcr.io/dnviti/arsenale/ssh-gateway:stable"
	remoteGuacdImage      = "guacamole/guacd:1.6.0"
	remoteDBProxyImage    = "ghcr.io/dnviti/arsenale/db-proxy:stable"
)

type managedContainerPortBinding struct {
	ContainerPort int
	HostPort      int
	Publish       bool
}

type managedContainerHealthcheck struct {
	Test        []string
	IntervalSec int
	TimeoutSec  int
	Retries     int
	StartPeriod int
}

type managedContainerConfig struct {
	Image         string
	Name          string
	Env           map[string]string
	Ports         []managedContainerPortBinding
	Labels        map[string]string
	Healthcheck   *managedContainerHealthcheck
	Networks      []string
	DNSServers    []string
	ResolvConf    string
	Binds         []string
	User          string
	RestartPolicy string
}

type managedContainerInfo struct {
	ID             string
	Name           string
	IPAddress      string
	NetworkIPs     map[string]string
	Status         string
	Health         string
	ContainerPorts map[int]int
	PublishedPorts map[int]int
}

type dockerSocketClient struct {
	kind       string
	socketPath string
	baseURL    string
	httpClient *http.Client
}
