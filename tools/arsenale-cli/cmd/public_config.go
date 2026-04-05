package cmd

import (
	"encoding/json"
	"fmt"
)

type publicConfig struct {
	Features publicConfigFeatures `json:"features"`
}

type publicConfigFeatures struct {
	IPGeolocationEnabled bool `json:"ipGeolocationEnabled"`
	MultiTenancyEnabled  bool `json:"multiTenancyEnabled"`
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

func ensureMultiTenancyEnabled(cfg *CLIConfig) error {
	features, err := getPublicConfigFeatures(cfg)
	if err != nil {
		return err
	}
	if !features.MultiTenancyEnabled {
		return fmt.Errorf("multi-tenancy is disabled on this platform")
	}
	return nil
}

func ensureIPGeolocationEnabled(cfg *CLIConfig) error {
	features, err := getPublicConfigFeatures(cfg)
	if err != nil {
		return err
	}
	if !features.IPGeolocationEnabled {
		return fmt.Errorf("IP geolocation is disabled on this platform")
	}
	return nil
}
