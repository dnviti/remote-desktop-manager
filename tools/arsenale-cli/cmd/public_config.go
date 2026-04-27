package cmd

import (
	"encoding/json"
	"fmt"
)

type publicConfig struct {
	Features publicConfigFeatures `json:"features"`
}

type publicConfigFeature string

const (
	publicFeatureKeychain         publicConfigFeature = "keychain"
	publicFeatureMultiTenancy     publicConfigFeature = "multi_tenancy"
	publicFeatureConnections      publicConfigFeature = "connections"
	publicFeatureIPGeolocation    publicConfigFeature = "ip_geolocation"
	publicFeatureDatabases        publicConfigFeature = "databases"
	publicFeatureRecordings       publicConfigFeature = "recordings"
	publicFeatureZeroTrust        publicConfigFeature = "zero_trust"
	publicFeatureAgenticAI        publicConfigFeature = "agentic_ai"
	publicFeatureEnterpriseAuth   publicConfigFeature = "enterprise_auth"
	publicFeatureSharingApprovals publicConfigFeature = "sharing_approvals"
	publicFeatureCLI              publicConfigFeature = "cli"
)

type publicConfigFeatures struct {
	EnabledCapabilities     []publicConfigFeature `json:"enabledCapabilities"`
	DatabaseProxyEnabled    bool                  `json:"databaseProxyEnabled"`
	ConnectionsEnabled      bool                  `json:"connectionsEnabled"`
	IPGeolocationEnabled    bool                  `json:"ipGeolocationEnabled"`
	KeychainEnabled         bool                  `json:"keychainEnabled"`
	MultiTenancyEnabled     bool                  `json:"multiTenancyEnabled"`
	RecordingsEnabled       bool                  `json:"recordingsEnabled"`
	ZeroTrustEnabled        bool                  `json:"zeroTrustEnabled"`
	AgenticAIEnabled        bool                  `json:"agenticAIEnabled"`
	EnterpriseAuthEnabled   bool                  `json:"enterpriseAuthEnabled"`
	SharingApprovalsEnabled bool                  `json:"sharingApprovalsEnabled"`
	CLIEnabled              bool                  `json:"cliEnabled"`
}

func getPublicConfigFeatures(cfg *CLIConfig) (publicConfigFeatures, error) {
	body, status, err := apiGet("/api/auth/config", cfg)
	if err != nil {
		return publicConfigFeatures{}, err
	}
	if status != 200 {
		return publicConfigFeatures{}, fmt.Errorf("load public config: %s", parseErrorMessage(body))
	}

	var response publicConfig
	if err := json.Unmarshal(body, &response); err != nil {
		return publicConfigFeatures{}, fmt.Errorf("parse public config: %w", err)
	}
	return response.Features, nil
}

func (f publicConfigFeatures) Enabled(feature publicConfigFeature) bool {
	switch feature {
	case publicFeatureKeychain:
		return f.KeychainEnabled
	case publicFeatureMultiTenancy:
		return f.MultiTenancyEnabled
	case publicFeatureConnections:
		return f.ConnectionsEnabled
	case publicFeatureIPGeolocation:
		return f.IPGeolocationEnabled
	case publicFeatureDatabases:
		return f.DatabaseProxyEnabled
	case publicFeatureRecordings:
		return f.RecordingsEnabled
	case publicFeatureZeroTrust:
		return f.ZeroTrustEnabled
	case publicFeatureAgenticAI:
		return f.AgenticAIEnabled
	case publicFeatureEnterpriseAuth:
		return f.EnterpriseAuthEnabled
	case publicFeatureSharingApprovals:
		return f.SharingApprovalsEnabled
	case publicFeatureCLI:
		return f.CLIEnabled
	default:
		for _, enabled := range f.EnabledCapabilities {
			if enabled == feature {
				return true
			}
		}
		return false
	}
}

func ensurePublicFeatureEnabled(cfg *CLIConfig, feature publicConfigFeature, label string) error {
	features, err := getPublicConfigFeatures(cfg)
	if err != nil {
		return err
	}
	if !features.Enabled(feature) {
		return fmt.Errorf("%s is disabled on this platform", label)
	}
	return nil
}

func ensureMultiTenancyEnabled(cfg *CLIConfig) error {
	return ensurePublicFeatureEnabled(cfg, publicFeatureMultiTenancy, "multi-tenancy")
}

func ensureIPGeolocationEnabled(cfg *CLIConfig) error {
	return ensurePublicFeatureEnabled(cfg, publicFeatureIPGeolocation, "IP geolocation")
}
