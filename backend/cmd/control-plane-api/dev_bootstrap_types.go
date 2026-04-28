package main

import (
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

const (
	devBootstrapIP        = "127.0.0.1"
	devBootstrapUserAgent = "arsenale-control-plane-api/dev-bootstrap"
)

type devBootstrapOptions struct {
	adminEmail        string
	adminPassword     string
	adminUsername     string
	tenantName        string
	certDir           string
	orchestratorName  string
	orchestratorKind  contracts.OrchestratorConnectionKind
	orchestratorScope contracts.OrchestratorScope
	orchestratorURL   string
}

type devGatewaySpec struct {
	ID             string
	Name           string
	Type           string
	Host           string
	Port           int
	APIPort        *int
	DeploymentMode string
	IsManaged      bool
	TunnelEnabled  bool
	Token          string
	CertDir        string
	Description    string
	EgressPolicy   string
}

type devDemoDatabaseSpec struct {
	Name        string
	Host        string
	Port        int
	Username    string
	Password    string
	Description string
	DBSettings  map[string]any
}

type devBootstrapRuntime struct {
	features              runtimefeatures.Manifest
	tunnelFixturesEnabled bool
	demoDatabasesEnabled  bool
}
