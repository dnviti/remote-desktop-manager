package dbsessions

import (
	"context"
	"strings"
)

type OwnedAIContext struct {
	ConnectionID             string
	Protocol                 string
	DatabaseName             string
	FirewallEnabled          *bool
	MaskingEnabled           *bool
	RateLimitEnabled         *bool
	AIQueryGenerationEnabled *bool
	AIQueryGenerationBackend string
	AIQueryGenerationModel   string
	AIQueryOptimizerEnabled  *bool
	AIQueryOptimizerBackend  string
	AIQueryOptimizerModel    string
}

func settingBoolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func trimSetting(value string) string {
	return strings.TrimSpace(value)
}

func (s Service) ResolveOwnedAIContext(ctx context.Context, userID, tenantID, sessionID string) (OwnedAIContext, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return OwnedAIContext{}, err
	}

	return OwnedAIContext{
		ConnectionID:             runtime.Connection.ID,
		Protocol:                 runtime.Protocol,
		DatabaseName:             runtime.DatabaseName,
		FirewallEnabled:          runtime.Settings.FirewallEnabled,
		MaskingEnabled:           runtime.Settings.MaskingEnabled,
		RateLimitEnabled:         runtime.Settings.RateLimitEnabled,
		AIQueryGenerationEnabled: runtime.Settings.AIQueryGenerationEnabled,
		AIQueryGenerationBackend: trimSetting(runtime.Settings.AIQueryGenerationBackend),
		AIQueryGenerationModel:   trimSetting(runtime.Settings.AIQueryGenerationModel),
		AIQueryOptimizerEnabled:  runtime.Settings.AIQueryOptimizerEnabled,
		AIQueryOptimizerBackend:  trimSetting(runtime.Settings.AIQueryOptimizerBackend),
		AIQueryOptimizerModel:    trimSetting(runtime.Settings.AIQueryOptimizerModel),
	}, nil
}
