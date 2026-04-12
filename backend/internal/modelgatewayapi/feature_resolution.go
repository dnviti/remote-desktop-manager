package modelgatewayapi

import (
	"context"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/dbsessions"
)

func llmOverridesFromExecution(execution aiFeatureExecution) *llmOverrides {
	if !execution.Enabled {
		return nil
	}
	return &llmOverrides{
		Provider:    execution.Backend.Provider,
		APIKey:      strings.TrimSpace(execution.Backend.APIKey),
		Model:       strings.TrimSpace(execution.ModelID),
		BaseURL:     strings.TrimSpace(execution.Backend.BaseURL),
		MaxTokens:   execution.MaxTokens,
		Temperature: &execution.Temperature,
		Timeout:     execution.Timeout,
	}
}

func providerAndModelFromOverrides(overrides *llmOverrides) (string, string) {
	if overrides == nil {
		return "none", ""
	}
	provider := strings.TrimSpace(string(overrides.Provider))
	if provider == "" {
		provider = "none"
	}
	modelID := strings.TrimSpace(overrides.Model)
	return provider, modelID
}

func (s Service) resolveFeatureExecutionForSession(ctx context.Context, userID, tenantID, sessionID, featureName string) (dbsessions.OwnedAIContext, aiFeatureExecution, error) {
	aiContext, err := s.DatabaseSessions.ResolveOwnedAIContext(ctx, userID, tenantID, sessionID)
	if err != nil {
		return dbsessions.OwnedAIContext{}, aiFeatureExecution{}, err
	}
	platform, err := s.loadPlatformConfig(ctx, tenantID)
	if err != nil {
		return dbsessions.OwnedAIContext{}, aiFeatureExecution{}, err
	}
	execution, err := resolveFeatureExecution(platform, aiContext, featureName)
	if err != nil {
		return dbsessions.OwnedAIContext{}, aiFeatureExecution{}, err
	}
	if execution.Enabled {
		return aiContext, execution, nil
	}

	message := "AI feature is not enabled"
	switch featureName {
	case "query-generation":
		message = "AI query generation is not enabled"
	case "query-optimizer":
		message = "AI query optimization is not enabled"
	}
	return aiContext, aiFeatureExecution{}, &requestError{status: http.StatusForbidden, message: message}
}
