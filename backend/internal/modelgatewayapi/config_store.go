package modelgatewayapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/dbsessions"
	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type legacyConfigRow struct {
	Loaded                 bool
	Provider               contracts.AIProviderID
	EncryptedAPIKey        string
	APIKeyIV               string
	APIKeyTag              string
	ModelID                string
	BaseURL                string
	MaxTokensPerRequest    int
	DailyRequestLimit      int
	Enabled                bool
	QueryGenerationBackend string
	QueryGenerationModel   string
	QueryOptimizerEnabled  bool
	QueryOptimizerBackend  string
	QueryOptimizerModel    string
	Temperature            float64
	TimeoutMS              int
}

func defaultStoredAIConfig() storedAIConfig {
	return storedAIConfig{
		QueryGeneration: storedAIFeature{
			Enabled:             false,
			MaxTokensPerRequest: 4096,
			DailyRequestLimit:   100,
		},
		QueryOptimizer: storedAIFeature{
			Enabled:             false,
			MaxTokensPerRequest: 4096,
		},
		Temperature: 0.2,
		TimeoutMS:   60000,
	}
}

func normalizeFeatureConfig(feature storedAIFeature, defaultMaxTokens, defaultDailyLimit int) storedAIFeature {
	feature.Backend = strings.TrimSpace(feature.Backend)
	feature.ModelID = strings.TrimSpace(feature.ModelID)
	if feature.MaxTokensPerRequest <= 0 {
		feature.MaxTokensPerRequest = defaultMaxTokens
	}
	if defaultDailyLimit > 0 && feature.DailyRequestLimit <= 0 {
		feature.DailyRequestLimit = defaultDailyLimit
	}
	return feature
}

func (s Service) loadLegacyConfigRow(ctx context.Context, tenantID string) (legacyConfigRow, error) {
	if s.DB == nil {
		return legacyConfigRow{}, errors.New("database is unavailable")
	}

	row := s.DB.QueryRow(ctx, `
SELECT provider,
       COALESCE("encryptedApiKey", ''),
       COALESCE("apiKeyIV", ''),
       COALESCE("apiKeyTag", ''),
       COALESCE("modelId", ''),
       COALESCE("baseUrl", ''),
       "maxTokensPerRequest",
       "dailyRequestLimit",
       enabled,
       COALESCE("queryGenerationBackend", ''),
       COALESCE("queryGenerationModel", ''),
       "queryOptimizerEnabled",
       COALESCE("queryOptimizerBackend", ''),
       COALESCE("queryOptimizerModel", ''),
       temperature,
       "timeoutMs"
FROM "TenantAiConfig"
WHERE "tenantId" = $1
`, tenantID)

	var item legacyConfigRow
	if err := row.Scan(
		&item.Provider,
		&item.EncryptedAPIKey,
		&item.APIKeyIV,
		&item.APIKeyTag,
		&item.ModelID,
		&item.BaseURL,
		&item.MaxTokensPerRequest,
		&item.DailyRequestLimit,
		&item.Enabled,
		&item.QueryGenerationBackend,
		&item.QueryGenerationModel,
		&item.QueryOptimizerEnabled,
		&item.QueryOptimizerBackend,
		&item.QueryOptimizerModel,
		&item.Temperature,
		&item.TimeoutMS,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return legacyConfigRow{}, nil
		}
		return legacyConfigRow{}, fmt.Errorf("load tenant ai config: %w", err)
	}

	item.Loaded = true
	item.ModelID = strings.TrimSpace(item.ModelID)
	item.BaseURL = strings.TrimSpace(item.BaseURL)
	item.QueryGenerationBackend = strings.TrimSpace(item.QueryGenerationBackend)
	item.QueryGenerationModel = strings.TrimSpace(item.QueryGenerationModel)
	item.QueryOptimizerBackend = strings.TrimSpace(item.QueryOptimizerBackend)
	item.QueryOptimizerModel = strings.TrimSpace(item.QueryOptimizerModel)
	return item, nil
}

func (s Service) loadStoredBackends(ctx context.Context, tenantID string) ([]storedAIBackend, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}

	rows, err := s.DB.Query(ctx, `
SELECT id,
       name,
       provider,
       COALESCE("encryptedApiKey", ''),
       COALESCE("apiKeyIV", ''),
       COALESCE("apiKeyTag", ''),
       COALESCE("baseUrl", ''),
       COALESCE("defaultModel", ''),
       "createdAt",
       "updatedAt"
FROM "TenantAiBackend"
WHERE "tenantId" = $1
ORDER BY name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant ai backends: %w", err)
	}
	defer rows.Close()

	items := make([]storedAIBackend, 0)
	for rows.Next() {
		var item storedAIBackend
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&item.Provider,
			&item.EncryptedAPIKey,
			&item.APIKeyIV,
			&item.APIKeyTag,
			&item.BaseURL,
			&item.DefaultModel,
			&item.CreatedAt,
			&item.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tenant ai backend: %w", err)
		}
		item.Name = strings.TrimSpace(item.Name)
		item.BaseURL = strings.TrimSpace(item.BaseURL)
		item.DefaultModel = strings.TrimSpace(item.DefaultModel)
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant ai backends: %w", err)
	}
	return items, nil
}

func decryptStoredBackend(item storedAIBackend, key []byte) runtimeAIBackend {
	runtime := runtimeAIBackend{
		Name:         item.Name,
		Provider:     item.Provider,
		BaseURL:      item.BaseURL,
		DefaultModel: item.DefaultModel,
	}
	if item.EncryptedAPIKey != "" && item.APIKeyIV != "" && item.APIKeyTag != "" && len(key) > 0 {
		if decrypted, err := modelgateway.DecryptAPIKey(item.EncryptedAPIKey, item.APIKeyIV, item.APIKeyTag, key); err == nil {
			runtime.APIKey = strings.TrimSpace(decrypted)
		}
	}
	return runtime
}

func decryptLegacyBackend(row legacyConfigRow, key []byte) runtimeAIBackend {
	runtime := runtimeAIBackend{
		Name:         "default",
		Provider:     row.Provider,
		BaseURL:      row.BaseURL,
		DefaultModel: row.ModelID,
	}
	if row.EncryptedAPIKey != "" && row.APIKeyIV != "" && row.APIKeyTag != "" && len(key) > 0 {
		if decrypted, err := modelgateway.DecryptAPIKey(row.EncryptedAPIKey, row.APIKeyIV, row.APIKeyTag, key); err == nil {
			runtime.APIKey = strings.TrimSpace(decrypted)
		}
	}
	return runtime
}

func hasLegacyProvider(row legacyConfigRow) bool {
	provider := strings.TrimSpace(string(row.Provider))
	return provider != "" && row.Provider != contracts.AIProviderNone
}

func buildStoredConfig(row legacyConfigRow, backends []storedAIBackend) storedAIConfig {
	config := defaultStoredAIConfig()
	config.QueryGeneration = storedAIFeature{
		Enabled:             row.Enabled,
		Backend:             row.QueryGenerationBackend,
		ModelID:             row.QueryGenerationModel,
		MaxTokensPerRequest: row.MaxTokensPerRequest,
		DailyRequestLimit:   row.DailyRequestLimit,
	}
	config.QueryOptimizer = storedAIFeature{
		Enabled:             row.QueryOptimizerEnabled,
		Backend:             row.QueryOptimizerBackend,
		ModelID:             row.QueryOptimizerModel,
		MaxTokensPerRequest: row.MaxTokensPerRequest,
	}
	if row.Temperature != 0 {
		config.Temperature = row.Temperature
	}
	if row.TimeoutMS > 0 {
		config.TimeoutMS = row.TimeoutMS
	}

	hasNamedBackends := len(backends) > 0
	if !hasNamedBackends && hasLegacyProvider(row) {
		if config.QueryGeneration.Backend == "" {
			config.QueryGeneration.Backend = "default"
		}
		if config.QueryGeneration.ModelID == "" {
			config.QueryGeneration.ModelID = row.ModelID
		}
		if !config.QueryOptimizer.Enabled {
			config.QueryOptimizer.Enabled = true
		}
		if config.QueryOptimizer.Backend == "" {
			config.QueryOptimizer.Backend = "default"
		}
		if config.QueryOptimizer.ModelID == "" {
			config.QueryOptimizer.ModelID = row.ModelID
		}
	}

	config.QueryGeneration = normalizeFeatureConfig(config.QueryGeneration, 4096, 100)
	config.QueryOptimizer = normalizeFeatureConfig(config.QueryOptimizer, 4096, 0)
	return config
}

func buildConfigResponse(config storedAIConfig, backends []storedAIBackend, legacyRow legacyConfigRow) configResponse {
	items := make([]aiBackendResponse, 0, len(backends)+1)
	for _, backend := range backends {
		item := aiBackendResponse{
			Name:         backend.Name,
			Provider:     backend.Provider,
			HasAPIKey:    backend.EncryptedAPIKey != "",
			DefaultModel: backend.DefaultModel,
		}
		if backend.BaseURL != "" {
			baseURL := backend.BaseURL
			item.BaseURL = &baseURL
		}
		items = append(items, item)
	}

	if len(items) == 0 && hasLegacyProvider(legacyRow) {
		item := aiBackendResponse{
			Name:         "default",
			Provider:     legacyRow.Provider,
			HasAPIKey:    legacyRow.EncryptedAPIKey != "",
			DefaultModel: legacyRow.ModelID,
		}
		if legacyRow.BaseURL != "" {
			baseURL := legacyRow.BaseURL
			item.BaseURL = &baseURL
		}
		items = append(items, item)
	}

	response := configResponse{
		Backends: items,
		QueryGeneration: aiFeatureResponse{
			Enabled:             config.QueryGeneration.Enabled,
			Backend:             config.QueryGeneration.Backend,
			ModelID:             config.QueryGeneration.ModelID,
			MaxTokensPerRequest: config.QueryGeneration.MaxTokensPerRequest,
			DailyRequestLimit:   config.QueryGeneration.DailyRequestLimit,
		},
		QueryOptimizer: aiFeatureResponse{
			Enabled:             config.QueryOptimizer.Enabled,
			Backend:             config.QueryOptimizer.Backend,
			ModelID:             config.QueryOptimizer.ModelID,
			MaxTokensPerRequest: config.QueryOptimizer.MaxTokensPerRequest,
		},
		Temperature: config.Temperature,
		TimeoutMS:   config.TimeoutMS,
	}

	legacyBackendName := strings.TrimSpace(config.QueryGeneration.Backend)
	for _, backend := range response.Backends {
		if backend.Name != legacyBackendName {
			continue
		}
		response.Provider = backend.Provider
		response.HasAPIKey = backend.HasAPIKey
		response.BaseURL = backend.BaseURL
		break
	}
	response.ModelID = response.QueryGeneration.ModelID
	if response.ModelID == "" {
		for _, backend := range response.Backends {
			if backend.Name == legacyBackendName {
				response.ModelID = backend.DefaultModel
				break
			}
		}
	}
	if response.Provider == "" {
		response.Provider = contracts.AIProviderNone
	}
	response.MaxTokensPerRequest = response.QueryGeneration.MaxTokensPerRequest
	response.DailyRequestLimit = response.QueryGeneration.DailyRequestLimit
	response.Enabled = response.QueryGeneration.Enabled
	return response
}

func (s Service) getConfig(ctx context.Context, tenantID string) (configResponse, error) {
	legacyRow, err := s.loadLegacyConfigRow(ctx, tenantID)
	if err != nil {
		return configResponse{}, err
	}
	backends, err := s.loadStoredBackends(ctx, tenantID)
	if err != nil {
		return configResponse{}, err
	}
	return buildConfigResponse(buildStoredConfig(legacyRow, backends), backends, legacyRow), nil
}

func buildEnvPlatformConfig() (aiPlatformConfig, bool) {
	envCfg := loadAIEnvConfig()
	if strings.TrimSpace(string(envCfg.Provider)) == "" || envCfg.Provider == contracts.AIProviderNone {
		return aiPlatformConfig{}, false
	}

	defaultModel := strings.TrimSpace(envCfg.Model)
	if defaultModel == "" {
		defaultModel = defaultModelForProvider(envCfg.Provider)
	}
	queryGenerationModel := strings.TrimSpace(envCfg.QueryGenerationModel)
	if queryGenerationModel == "" {
		queryGenerationModel = defaultModel
	}

	return aiPlatformConfig{
		Backends: []runtimeAIBackend{{
			Name:         "environment",
			Provider:     envCfg.Provider,
			APIKey:       strings.TrimSpace(envCfg.APIKey),
			BaseURL:      strings.TrimSpace(envCfg.BaseURL),
			DefaultModel: defaultModel,
		}},
		QueryGeneration: normalizeFeatureConfig(storedAIFeature{
			Enabled:             envCfg.QueryGenerationEnabled,
			Backend:             "environment",
			ModelID:             queryGenerationModel,
			MaxTokensPerRequest: envCfg.MaxTokens,
			DailyRequestLimit:   envCfg.MaxRequestsPerDay,
		}, 4096, 100),
		QueryOptimizer: normalizeFeatureConfig(storedAIFeature{
			Enabled:             true,
			Backend:             "environment",
			ModelID:             defaultModel,
			MaxTokensPerRequest: envCfg.MaxTokens,
		}, 4096, 0),
		Temperature: envCfg.Temperature,
		Timeout:     envCfg.Timeout,
	}, true
}

func (s Service) loadPlatformConfig(ctx context.Context, tenantID string) (aiPlatformConfig, error) {
	legacyRow, err := s.loadLegacyConfigRow(ctx, tenantID)
	if err != nil {
		return aiPlatformConfig{}, err
	}
	backends, err := s.loadStoredBackends(ctx, tenantID)
	if err != nil {
		return aiPlatformConfig{}, err
	}

	config := buildStoredConfig(legacyRow, backends)
	runtimeBackends := make([]runtimeAIBackend, 0, len(backends)+1)
	for _, backend := range backends {
		runtimeBackends = append(runtimeBackends, decryptStoredBackend(backend, s.ServerEncryptionKey))
	}
	if len(runtimeBackends) == 0 && hasLegacyProvider(legacyRow) {
		runtimeBackends = append(runtimeBackends, decryptLegacyBackend(legacyRow, s.ServerEncryptionKey))
	}
	if len(runtimeBackends) == 0 && !legacyRow.Loaded {
		if envPlatform, ok := buildEnvPlatformConfig(); ok {
			return envPlatform, nil
		}
	}

	return aiPlatformConfig{
		Backends:        runtimeBackends,
		QueryGeneration: config.QueryGeneration,
		QueryOptimizer:  config.QueryOptimizer,
		Temperature:     config.Temperature,
		Timeout:         time.Duration(config.TimeoutMS) * time.Millisecond,
	}, nil
}

func backendMapByName(items []storedAIBackend) map[string]storedAIBackend {
	result := make(map[string]storedAIBackend, len(items))
	for _, item := range items {
		result[item.Name] = item
	}
	return result
}

func normalizeBackendUpdate(input aiBackendUpdate, existing map[string]storedAIBackend, encryptionKey []byte) (storedAIBackend, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return storedAIBackend{}, errors.New("backend name is required")
	}
	if input.Provider == "" || input.Provider == contracts.AIProviderNone {
		return storedAIBackend{}, fmt.Errorf("backend %q requires a provider", name)
	}
	providerMeta, ok := modelgateway.LookupProvider(input.Provider)
	if !ok || input.Provider == contracts.AIProviderNone {
		return storedAIBackend{}, fmt.Errorf("backend %q has an unsupported provider %q", name, input.Provider)
	}

	current, hasCurrent := existing[name]
	item := storedAIBackend{
		ID:           uuid.NewString(),
		Name:         name,
		Provider:     input.Provider,
		BaseURL:      strings.TrimSpace(stringOrEmpty(input.BaseURL)),
		DefaultModel: strings.TrimSpace(stringOrEmpty(input.DefaultModel)),
	}
	if hasCurrent {
		item.ID = current.ID
		item.CreatedAt = current.CreatedAt
		item.UpdatedAt = current.UpdatedAt
		item.EncryptedAPIKey = current.EncryptedAPIKey
		item.APIKeyIV = current.APIKeyIV
		item.APIKeyTag = current.APIKeyTag
	}

	if input.ClearAPIKey {
		item.EncryptedAPIKey = ""
		item.APIKeyIV = ""
		item.APIKeyTag = ""
	}
	if input.APIKey != nil {
		apiKey := strings.TrimSpace(*input.APIKey)
		if apiKey == "" {
			item.EncryptedAPIKey = ""
			item.APIKeyIV = ""
			item.APIKeyTag = ""
		} else {
			if len(encryptionKey) == 0 {
				return storedAIBackend{}, errors.New("SERVER_ENCRYPTION_KEY is required to store apiKey")
			}
			ciphertext, iv, tag, err := modelgateway.EncryptAPIKey(apiKey, encryptionKey)
			if err != nil {
				return storedAIBackend{}, err
			}
			item.EncryptedAPIKey = ciphertext
			item.APIKeyIV = iv
			item.APIKeyTag = tag
		}
	}

	if providerMeta.RequiresBaseURL && item.BaseURL == "" {
		return storedAIBackend{}, fmt.Errorf("backend %q requires baseUrl", name)
	}
	if providerMeta.RequiresAPIKey && item.EncryptedAPIKey == "" {
		return storedAIBackend{}, fmt.Errorf("backend %q requires an apiKey", name)
	}
	if item.DefaultModel == "" {
		item.DefaultModel = providerMeta.DefaultModel
	}
	return item, nil
}

func normalizeFeatureUpdate(feature aiFeatureUpdate, defaultMaxTokens, defaultDailyLimit int) storedAIFeature {
	item := storedAIFeature{
		Enabled:             feature.Enabled,
		Backend:             strings.TrimSpace(feature.Backend),
		ModelID:             strings.TrimSpace(feature.ModelID),
		MaxTokensPerRequest: feature.MaxTokensPerRequest,
		DailyRequestLimit:   feature.DailyRequestLimit,
	}
	return normalizeFeatureConfig(item, defaultMaxTokens, defaultDailyLimit)
}

func validateFeatureBackend(featureName string, feature storedAIFeature, backends []storedAIBackend) error {
	if !feature.Enabled {
		return nil
	}
	if strings.TrimSpace(feature.Backend) == "" {
		return fmt.Errorf("%s backend is required when the feature is enabled", featureName)
	}
	for _, backend := range backends {
		if backend.Name == feature.Backend {
			return nil
		}
	}
	return fmt.Errorf("%s backend %q is not configured", featureName, feature.Backend)
}

func legacyColumnsForFeature(feature storedAIFeature, backends []storedAIBackend) legacyConfigRow {
	row := legacyConfigRow{
		Provider:            contracts.AIProviderNone,
		MaxTokensPerRequest: feature.MaxTokensPerRequest,
		DailyRequestLimit:   feature.DailyRequestLimit,
		Enabled:             feature.Enabled,
		ModelID:             feature.ModelID,
	}
	for _, backend := range backends {
		if backend.Name != feature.Backend {
			continue
		}
		row.Provider = backend.Provider
		row.EncryptedAPIKey = backend.EncryptedAPIKey
		row.APIKeyIV = backend.APIKeyIV
		row.APIKeyTag = backend.APIKeyTag
		row.BaseURL = backend.BaseURL
		if row.ModelID == "" {
			row.ModelID = backend.DefaultModel
		}
		break
	}
	return row
}

func (s Service) saveConfig(ctx context.Context, tenantID, userID string, update configUpdate) (configResponse, error) {
	if s.DB == nil {
		return configResponse{}, errors.New("database is unavailable")
	}

	existingBackends, err := s.loadStoredBackends(ctx, tenantID)
	if err != nil {
		return configResponse{}, err
	}
	existingByName := backendMapByName(existingBackends)

	normalizedBackends := make([]storedAIBackend, 0, len(update.Backends))
	seenNames := make(map[string]struct{}, len(update.Backends))
	for _, backend := range update.Backends {
		normalized, err := normalizeBackendUpdate(backend, existingByName, s.ServerEncryptionKey)
		if err != nil {
			return configResponse{}, err
		}
		if _, exists := seenNames[normalized.Name]; exists {
			return configResponse{}, fmt.Errorf("backend name %q is duplicated", normalized.Name)
		}
		seenNames[normalized.Name] = struct{}{}
		normalizedBackends = append(normalizedBackends, normalized)
	}

	queryGeneration := normalizeFeatureUpdate(update.QueryGeneration, 4096, 100)
	queryOptimizer := normalizeFeatureUpdate(update.QueryOptimizer, 4096, 0)
	if err := validateFeatureBackend("queryGeneration", queryGeneration, normalizedBackends); err != nil {
		return configResponse{}, err
	}
	if err := validateFeatureBackend("queryOptimizer", queryOptimizer, normalizedBackends); err != nil {
		return configResponse{}, err
	}

	temperature := update.Temperature
	if temperature < 0 || temperature > 2 {
		return configResponse{}, errors.New("temperature must be between 0 and 2")
	}
	timeoutMS := update.TimeoutMS
	if timeoutMS <= 0 {
		timeoutMS = 60000
	}

	legacy := legacyColumnsForFeature(queryGeneration, normalizedBackends)
	legacy.QueryGenerationBackend = queryGeneration.Backend
	legacy.QueryGenerationModel = queryGeneration.ModelID
	legacy.QueryOptimizerEnabled = queryOptimizer.Enabled
	legacy.QueryOptimizerBackend = queryOptimizer.Backend
	legacy.QueryOptimizerModel = queryOptimizer.ModelID
	legacy.Temperature = temperature
	legacy.TimeoutMS = timeoutMS

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return configResponse{}, fmt.Errorf("begin ai config update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
INSERT INTO "TenantAiConfig" (
	id,
	"tenantId",
	provider,
	"encryptedApiKey",
	"apiKeyIV",
	"apiKeyTag",
	"modelId",
	"baseUrl",
	"maxTokensPerRequest",
	"dailyRequestLimit",
	enabled,
	"queryGenerationBackend",
	"queryGenerationModel",
	"queryOptimizerEnabled",
	"queryOptimizerBackend",
	"queryOptimizerModel",
	temperature,
	"timeoutMs",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1, $2, $3, NULLIF($4, ''), NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''),
	$9, $10, $11, NULLIF($12, ''), NULLIF($13, ''), $14, NULLIF($15, ''), NULLIF($16, ''), $17, $18, NOW(), NOW()
)
ON CONFLICT ("tenantId") DO UPDATE SET
	provider = EXCLUDED.provider,
	"encryptedApiKey" = EXCLUDED."encryptedApiKey",
	"apiKeyIV" = EXCLUDED."apiKeyIV",
	"apiKeyTag" = EXCLUDED."apiKeyTag",
	"modelId" = EXCLUDED."modelId",
	"baseUrl" = EXCLUDED."baseUrl",
	"maxTokensPerRequest" = EXCLUDED."maxTokensPerRequest",
	"dailyRequestLimit" = EXCLUDED."dailyRequestLimit",
	enabled = EXCLUDED.enabled,
	"queryGenerationBackend" = EXCLUDED."queryGenerationBackend",
	"queryGenerationModel" = EXCLUDED."queryGenerationModel",
	"queryOptimizerEnabled" = EXCLUDED."queryOptimizerEnabled",
	"queryOptimizerBackend" = EXCLUDED."queryOptimizerBackend",
	"queryOptimizerModel" = EXCLUDED."queryOptimizerModel",
	temperature = EXCLUDED.temperature,
	"timeoutMs" = EXCLUDED."timeoutMs",
	"updatedAt" = NOW()
`, uuid.NewString(), tenantID, legacy.Provider, legacy.EncryptedAPIKey, legacy.APIKeyIV, legacy.APIKeyTag, legacy.ModelID, legacy.BaseURL, queryGeneration.MaxTokensPerRequest, queryGeneration.DailyRequestLimit, queryGeneration.Enabled, queryGeneration.Backend, queryGeneration.ModelID, queryOptimizer.Enabled, queryOptimizer.Backend, queryOptimizer.ModelID, temperature, timeoutMS); err != nil {
		return configResponse{}, fmt.Errorf("upsert tenant ai config: %w", err)
	}

	names := make([]string, 0, len(normalizedBackends))
	for _, backend := range normalizedBackends {
		names = append(names, backend.Name)
	}
	if _, err := tx.Exec(ctx, `
DELETE FROM "TenantAiBackend"
WHERE "tenantId" = $1
  AND NOT (name = ANY($2))
`, tenantID, names); err != nil {
		return configResponse{}, fmt.Errorf("delete stale ai backends: %w", err)
	}
	if len(normalizedBackends) == 0 {
		if _, err := tx.Exec(ctx, `DELETE FROM "TenantAiBackend" WHERE "tenantId" = $1`, tenantID); err != nil {
			return configResponse{}, fmt.Errorf("clear ai backends: %w", err)
		}
	}

	for _, backend := range normalizedBackends {
		if _, err := tx.Exec(ctx, `
INSERT INTO "TenantAiBackend" (
	id,
	"tenantId",
	name,
	provider,
	"encryptedApiKey",
	"apiKeyIV",
	"apiKeyTag",
	"baseUrl",
	"defaultModel",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1, $2, $3, $4, NULLIF($5, ''), NULLIF($6, ''), NULLIF($7, ''), NULLIF($8, ''), NULLIF($9, ''), NOW(), NOW()
)
ON CONFLICT ("tenantId", name) DO UPDATE SET
	provider = EXCLUDED.provider,
	"encryptedApiKey" = EXCLUDED."encryptedApiKey",
	"apiKeyIV" = EXCLUDED."apiKeyIV",
	"apiKeyTag" = EXCLUDED."apiKeyTag",
	"baseUrl" = EXCLUDED."baseUrl",
	"defaultModel" = EXCLUDED."defaultModel",
	"updatedAt" = NOW()
`, backend.ID, tenantID, backend.Name, backend.Provider, backend.EncryptedAPIKey, backend.APIKeyIV, backend.APIKeyTag, backend.BaseURL, backend.DefaultModel); err != nil {
			return configResponse{}, fmt.Errorf("upsert ai backend %q: %w", backend.Name, err)
		}
	}

	if err := s.insertAuditLog(ctx, userID, "APP_CONFIG_UPDATE", "ai_config", tenantID, map[string]any{
		"backendNames":       names,
		"queryGeneration":    map[string]any{"enabled": queryGeneration.Enabled, "backend": queryGeneration.Backend, "modelId": queryGeneration.ModelID},
		"queryOptimizer":     map[string]any{"enabled": queryOptimizer.Enabled, "backend": queryOptimizer.Backend, "modelId": queryOptimizer.ModelID},
		"temperature":        temperature,
		"timeoutMs":          timeoutMS,
		"configuredBackends": len(normalizedBackends),
	}, ""); err != nil {
		return configResponse{}, fmt.Errorf("audit ai config update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return configResponse{}, fmt.Errorf("commit ai config update: %w", err)
	}

	return buildConfigResponse(storedAIConfig{
		QueryGeneration: queryGeneration,
		QueryOptimizer:  queryOptimizer,
		Temperature:     temperature,
		TimeoutMS:       timeoutMS,
	}, normalizedBackends, legacy), nil
}

func stringOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func findRuntimeBackend(backends []runtimeAIBackend, name string) (runtimeAIBackend, bool) {
	name = strings.TrimSpace(name)
	if name == "" {
		return runtimeAIBackend{}, false
	}
	for _, backend := range backends {
		if backend.Name == name {
			return backend, true
		}
	}
	return runtimeAIBackend{}, false
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func resolveFeatureExecution(platform aiPlatformConfig, context dbsessions.OwnedAIContext, featureName string) (aiFeatureExecution, error) {
	switch featureName {
	case "query-generation":
		enabled := boolOrDefault(context.AIQueryGenerationEnabled, platform.QueryGeneration.Enabled)
		backendName := strings.TrimSpace(context.AIQueryGenerationBackend)
		if backendName == "" {
			backendName = platform.QueryGeneration.Backend
		}
		modelID := strings.TrimSpace(context.AIQueryGenerationModel)
		if modelID == "" {
			modelID = platform.QueryGeneration.ModelID
		}
		return buildFeatureExecution(platform, enabled, backendName, modelID, platform.QueryGeneration.MaxTokensPerRequest, platform.QueryGeneration.DailyRequestLimit)
	case "query-optimizer":
		enabled := boolOrDefault(context.AIQueryOptimizerEnabled, platform.QueryOptimizer.Enabled)
		backendName := strings.TrimSpace(context.AIQueryOptimizerBackend)
		if backendName == "" {
			backendName = platform.QueryOptimizer.Backend
		}
		modelID := strings.TrimSpace(context.AIQueryOptimizerModel)
		if modelID == "" {
			modelID = platform.QueryOptimizer.ModelID
		}
		return buildFeatureExecution(platform, enabled, backendName, modelID, platform.QueryOptimizer.MaxTokensPerRequest, platform.QueryOptimizer.DailyRequestLimit)
	default:
		return aiFeatureExecution{}, fmt.Errorf("unsupported ai feature %q", featureName)
	}
}

func buildFeatureExecution(platform aiPlatformConfig, enabled bool, backendName, modelID string, maxTokens, dailyLimit int) (aiFeatureExecution, error) {
	if !enabled {
		return aiFeatureExecution{}, nil
	}
	backend, ok := findRuntimeBackend(platform.Backends, backendName)
	if !ok {
		return aiFeatureExecution{}, &requestError{status: 503, message: "AI backend is not configured or is unavailable."}
	}
	if modelID == "" {
		modelID = strings.TrimSpace(backend.DefaultModel)
	}
	if modelID == "" {
		modelID = defaultModelForProvider(backend.Provider)
	}
	if modelID == "" {
		return aiFeatureExecution{}, &requestError{status: 503, message: "AI model is not configured and no default is available for the selected backend."}
	}

	providerMeta, ok := modelgateway.LookupProvider(backend.Provider)
	if !ok {
		return aiFeatureExecution{}, &requestError{status: 503, message: "AI backend provider is not supported."}
	}
	if providerMeta.RequiresAPIKey && strings.TrimSpace(backend.APIKey) == "" {
		return aiFeatureExecution{}, &requestError{status: 503, message: "AI backend API key is not configured."}
	}
	if providerMeta.RequiresBaseURL && strings.TrimSpace(backend.BaseURL) == "" {
		return aiFeatureExecution{}, &requestError{status: 503, message: fmt.Sprintf("AI backend base URL is required for %s.", backend.Provider)}
	}

	if maxTokens <= 0 {
		maxTokens = 4096
	}
	return aiFeatureExecution{
		Enabled:           true,
		Backend:           backend,
		ModelID:           modelID,
		MaxTokens:         maxTokens,
		DailyRequestLimit: dailyLimit,
		Temperature:       platform.Temperature,
		Timeout:           platform.Timeout,
	}, nil
}
