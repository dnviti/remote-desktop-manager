package runtimefeatures

import (
	"os"
	"strings"
)

type Routing struct {
	DirectGateway bool `json:"directGateway"`
	ZeroTrust     bool `json:"zeroTrust"`
}

type Manifest struct {
	Mode                    string  `json:"mode"`
	Backend                 string  `json:"backend"`
	DatabaseProxyEnabled    bool    `json:"databaseProxyEnabled"`
	ConnectionsEnabled      bool    `json:"connectionsEnabled"`
	IPGeolocationEnabled    bool    `json:"ipGeolocationEnabled"`
	KeychainEnabled         bool    `json:"keychainEnabled"`
	MultiTenancyEnabled     bool    `json:"multiTenancyEnabled"`
	RecordingsEnabled       bool    `json:"recordingsEnabled"`
	ZeroTrustEnabled        bool    `json:"zeroTrustEnabled"`
	AgenticAIEnabled        bool    `json:"agenticAIEnabled"`
	EnterpriseAuthEnabled   bool    `json:"enterpriseAuthEnabled"`
	SharingApprovalsEnabled bool    `json:"sharingApprovalsEnabled"`
	CLIEnabled              bool    `json:"cliEnabled"`
	Routing                 Routing `json:"routing"`
}

func FromEnv() Manifest {
	zeroTrustEnabled := boolEnv("FEATURE_ZERO_TRUST_ENABLED", true)
	directRouting := boolEnv("ARSENALE_DIRECT_ROUTING_ENABLED", !gatewayMandatory())
	if zeroTrustEnv := os.Getenv("ARSENALE_ZERO_TRUST_ENABLED"); strings.TrimSpace(zeroTrustEnv) != "" {
		zeroTrustEnabled = strings.EqualFold(strings.TrimSpace(zeroTrustEnv), "true")
	}
	return Manifest{
		Mode:                    defaultString(strings.TrimSpace(os.Getenv("ARSENALE_INSTALL_MODE")), defaultString(strings.TrimSpace(os.Getenv("NODE_ENV")), "production")),
		Backend:                 resolveBackend(),
		DatabaseProxyEnabled:    boolEnv("FEATURE_DATABASE_PROXY_ENABLED", true),
		ConnectionsEnabled:      boolEnv("FEATURE_CONNECTIONS_ENABLED", true),
		IPGeolocationEnabled:    boolEnv("FEATURE_IP_GEOLOCATION_ENABLED", true),
		KeychainEnabled:         boolEnv("FEATURE_KEYCHAIN_ENABLED", true),
		MultiTenancyEnabled:     boolEnv("FEATURE_MULTI_TENANCY_ENABLED", true),
		RecordingsEnabled:       boolEnv("FEATURE_RECORDINGS_ENABLED", boolEnv("RECORDING_ENABLED", true)),
		ZeroTrustEnabled:        zeroTrustEnabled,
		AgenticAIEnabled:        boolEnv("FEATURE_AGENTIC_AI_ENABLED", true),
		EnterpriseAuthEnabled:   boolEnv("FEATURE_ENTERPRISE_AUTH_ENABLED", true),
		SharingApprovalsEnabled: boolEnv("FEATURE_SHARING_APPROVALS_ENABLED", true),
		CLIEnabled:              boolEnv("CLI_ENABLED", false),
		Routing: Routing{
			DirectGateway: directRouting,
			ZeroTrust:     zeroTrustEnabled,
		},
	}
}

func (m Manifest) AnyConnectionFeature() bool {
	return m.ConnectionsEnabled || m.DatabaseProxyEnabled
}

func (m Manifest) AIQueryEnabled() bool {
	return m.DatabaseProxyEnabled && m.AgenticAIEnabled
}

func (m Manifest) PublicShareEnabled() bool {
	return m.SharingApprovalsEnabled && m.KeychainEnabled
}

func boolEnv(key string, fallback bool) bool {
	value, ok := os.LookupEnv(key)
	if !ok {
		return fallback
	}
	return !strings.EqualFold(strings.TrimSpace(value), "false")
}

func gatewayMandatory() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("GATEWAY_ROUTING_MODE")), "gateway-mandatory")
}

func defaultString(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func resolveBackend() string {
	if backend := strings.TrimSpace(os.Getenv("ARSENALE_INSTALL_BACKEND")); backend != "" {
		return backend
	}
	if backend := strings.TrimSpace(os.Getenv("ORCHESTRATOR_TYPE")); backend != "" {
		return backend
	}
	return "podman"
}
