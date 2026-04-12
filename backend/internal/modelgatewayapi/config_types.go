package modelgatewayapi

import (
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type aiBackendResponse struct {
	Name         string                 `json:"name"`
	Provider     contracts.AIProviderID `json:"provider"`
	HasAPIKey    bool                   `json:"hasApiKey"`
	BaseURL      *string                `json:"baseUrl,omitempty"`
	DefaultModel string                 `json:"defaultModel,omitempty"`
}

type aiFeatureResponse struct {
	Enabled             bool   `json:"enabled"`
	Backend             string `json:"backend,omitempty"`
	ModelID             string `json:"modelId,omitempty"`
	MaxTokensPerRequest int    `json:"maxTokensPerRequest"`
	DailyRequestLimit   int    `json:"dailyRequestLimit,omitempty"`
}

type configResponse struct {
	Backends        []aiBackendResponse `json:"backends"`
	QueryGeneration aiFeatureResponse   `json:"queryGeneration"`
	QueryOptimizer  aiFeatureResponse   `json:"queryOptimizer"`
	Temperature     float64             `json:"temperature"`
	TimeoutMS       int                 `json:"timeoutMs"`

	Provider            contracts.AIProviderID `json:"provider"`
	HasAPIKey           bool                   `json:"hasApiKey"`
	ModelID             string                 `json:"modelId"`
	BaseURL             *string                `json:"baseUrl"`
	MaxTokensPerRequest int                    `json:"maxTokensPerRequest"`
	DailyRequestLimit   int                    `json:"dailyRequestLimit"`
	Enabled             bool                   `json:"enabled"`
}

type aiBackendUpdate struct {
	Name         string                 `json:"name"`
	Provider     contracts.AIProviderID `json:"provider"`
	APIKey       *string                `json:"apiKey,omitempty"`
	ClearAPIKey  bool                   `json:"clearApiKey,omitempty"`
	BaseURL      *string                `json:"baseUrl,omitempty"`
	DefaultModel *string                `json:"defaultModel,omitempty"`
}

type aiFeatureUpdate struct {
	Enabled             bool   `json:"enabled"`
	Backend             string `json:"backend,omitempty"`
	ModelID             string `json:"modelId,omitempty"`
	MaxTokensPerRequest int    `json:"maxTokensPerRequest,omitempty"`
	DailyRequestLimit   int    `json:"dailyRequestLimit,omitempty"`
}

type configUpdate struct {
	Backends        []aiBackendUpdate `json:"backends"`
	QueryGeneration aiFeatureUpdate   `json:"queryGeneration"`
	QueryOptimizer  aiFeatureUpdate   `json:"queryOptimizer"`
	Temperature     float64           `json:"temperature"`
	TimeoutMS       int               `json:"timeoutMs"`
}

type storedAIConfig struct {
	QueryGeneration storedAIFeature
	QueryOptimizer  storedAIFeature
	Temperature     float64
	TimeoutMS       int
}

type storedAIBackend struct {
	ID              string
	Name            string
	Provider        contracts.AIProviderID
	EncryptedAPIKey string
	APIKeyIV        string
	APIKeyTag       string
	BaseURL         string
	DefaultModel    string
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

type storedAIFeature struct {
	Enabled             bool
	Backend             string
	ModelID             string
	MaxTokensPerRequest int
	DailyRequestLimit   int
}

type runtimeAIBackend struct {
	Name         string
	Provider     contracts.AIProviderID
	APIKey       string
	BaseURL      string
	DefaultModel string
}

type aiPlatformConfig struct {
	Backends        []runtimeAIBackend
	QueryGeneration storedAIFeature
	QueryOptimizer  storedAIFeature
	Temperature     float64
	Timeout         time.Duration
}

type aiFeatureExecution struct {
	Enabled           bool
	Backend           runtimeAIBackend
	ModelID           string
	MaxTokens         int
	DailyRequestLimit int
	Temperature       float64
	Timeout           time.Duration
}
