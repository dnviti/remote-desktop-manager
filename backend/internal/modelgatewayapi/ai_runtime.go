package modelgatewayapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
)

func (s Service) loadTenantRuntimeConfig(ctx context.Context, tenantID string) (tenantRuntimeConfig, error) {
	if s.DB == nil {
		return tenantRuntimeConfig{}, errors.New("model gateway store is not configured")
	}

	row := s.DB.QueryRow(ctx, `
SELECT provider,
       COALESCE("encryptedApiKey", ''),
       COALESCE("apiKeyIV", ''),
       COALESCE("apiKeyTag", ''),
       "modelId",
       COALESCE("baseUrl", ''),
       "maxTokensPerRequest",
       "dailyRequestLimit",
       enabled
FROM "TenantAiConfig"
WHERE "tenantId" = $1
`, tenantID)

	var (
		cfg tenantRuntimeConfig
		enc string
		iv  string
		tag string
	)
	if err := row.Scan(&cfg.Provider, &enc, &iv, &tag, &cfg.ModelID, &cfg.BaseURL, &cfg.MaxTokensPerRequest, &cfg.DailyRequestLimit, &cfg.Enabled); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return tenantRuntimeConfig{}, nil
		}
		return tenantRuntimeConfig{}, err
	}

	if enc != "" && iv != "" && tag != "" && len(s.ServerEncryptionKey) > 0 {
		apiKey, err := modelgateway.DecryptAPIKey(enc, iv, tag, s.ServerEncryptionKey)
		if err == nil {
			cfg.APIKey = apiKey
		}
	}
	return cfg, nil
}

func tenantLLMOverrides(tenantCfg tenantRuntimeConfig, envCfg aiEnvConfig) *llmOverrides {
	if tenantCfg.Provider == contracts.AIProviderNone {
		return nil
	}

	providerMeta, ok := modelgateway.LookupProvider(tenantCfg.Provider)
	if ok {
		if providerMeta.RequiresAPIKey && strings.TrimSpace(tenantCfg.APIKey) == "" {
			return nil
		}
		if providerMeta.RequiresBaseURL && strings.TrimSpace(tenantCfg.BaseURL) == "" {
			return nil
		}
	}

	return &llmOverrides{
		Provider:    tenantCfg.Provider,
		APIKey:      strings.TrimSpace(tenantCfg.APIKey),
		Model:       strings.TrimSpace(tenantCfg.ModelID),
		BaseURL:     strings.TrimSpace(tenantCfg.BaseURL),
		MaxTokens:   tenantCfg.MaxTokensPerRequest,
		Temperature: &envCfg.Temperature,
		Timeout:     envCfg.Timeout,
	}
}

func effectiveLLMProviderAndModel(overrides *llmOverrides, envCfg aiEnvConfig) (string, string) {
	provider := strings.TrimSpace(string(envCfg.Provider))
	modelID := strings.TrimSpace(envCfg.Model)
	if overrides != nil {
		if value := strings.TrimSpace(string(overrides.Provider)); value != "" {
			provider = value
		}
		if value := strings.TrimSpace(overrides.Model); value != "" {
			modelID = value
		}
	}
	if modelID == "" && provider != "" {
		modelID = defaultModelForProvider(contracts.AIProviderID(provider))
	}
	if provider == "" {
		provider = "none"
	}
	return provider, modelID
}

func (s Service) incrementDailyCounter(ctx context.Context, tenantID string, limit int) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}

	today := time.Now().UTC().Truncate(24 * time.Hour)
	if _, err := s.DB.Exec(ctx, `
INSERT INTO "AiDailyUsage" (id, "tenantId", date, count, "createdAt", "updatedAt")
VALUES ($1, $2, $3, 0, now(), now())
ON CONFLICT ("tenantId", date) DO NOTHING
`, uuid.NewString(), tenantID, today); err != nil {
		return fmt.Errorf("ensure ai daily usage: %w", err)
	}

	tag, err := s.DB.Exec(ctx, `
UPDATE "AiDailyUsage"
SET count = count + 1, "updatedAt" = now()
WHERE "tenantId" = $1 AND date = $2 AND count < $3
`, tenantID, today, limit)
	if err != nil {
		return fmt.Errorf("increment ai daily usage: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return &requestError{status: http.StatusTooManyRequests, message: "Daily AI query generation limit reached for this tenant"}
	}
	return nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	if s.DB == nil {
		return nil
	}

	rawDetails, err := json.Marshal(details)
	if err != nil {
		return err
	}

	_, err = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, NULLIF($2, ''), $3::"AuditAction", NULLIF($4, ''), NULLIF($5, ''), $6::jsonb, NULLIF($7, ''))
`, uuid.NewString(), strings.TrimSpace(userID), action, strings.TrimSpace(targetType), strings.TrimSpace(targetID), string(rawDetails), strings.TrimSpace(ipAddress))
	return err
}

func loadAIEnvConfig() aiEnvConfig {
	return aiEnvConfig{
		Provider:               contracts.AIProviderID(strings.TrimSpace(os.Getenv("AI_PROVIDER"))),
		APIKey:                 loadSecretEnv("AI_API_KEY", "AI_API_KEY_FILE"),
		Model:                  strings.TrimSpace(os.Getenv("AI_MODEL")),
		BaseURL:                strings.TrimSpace(os.Getenv("AI_BASE_URL")),
		MaxTokens:              parseEnvInt("AI_MAX_TOKENS", 4096),
		Temperature:            parseEnvFloat("AI_TEMPERATURE", 0.2),
		Timeout:                time.Duration(parseEnvInt("AI_TIMEOUT_MS", 60000)) * time.Millisecond,
		QueryGenerationEnabled: strings.EqualFold(strings.TrimSpace(os.Getenv("AI_QUERY_GENERATION_ENABLED")), "true"),
		QueryGenerationModel:   strings.TrimSpace(os.Getenv("AI_QUERY_GENERATION_MODEL")),
		MaxRequestsPerDay:      parseEnvInt("AI_MAX_REQUESTS_PER_DAY", 100),
	}
}

func defaultModelForProvider(provider contracts.AIProviderID) string {
	switch provider {
	case contracts.AIProviderAnthropic:
		return "claude-sonnet-4-20250514"
	case contracts.AIProviderOpenAI:
		return "gpt-4o"
	case contracts.AIProviderOllama:
		return "llama3.1:8b"
	default:
		return ""
	}
}

func loadSecretEnv(name, fileName string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	path := strings.TrimSpace(os.Getenv(fileName))
	if path == "" {
		return ""
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(payload))
}

func parseEnvInt(name string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func parseEnvFloat(name string, fallback float64) float64 {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseFloat(value, 64)
	if err != nil {
		return fallback
	}
	return parsed
}

func aiProviderHTTPError(status int, body []byte) string {
	detail := aiProviderErrorDetail(body)
	if status == http.StatusTooManyRequests {
		if detail != "" {
			return fmt.Sprintf("AI provider rate limit or quota exceeded (status %d): %s", status, detail)
		}
		return fmt.Sprintf("AI provider rate limit or quota exceeded (status %d). Check the configured API key, model access, and billing/quota.", status)
	}
	if detail != "" {
		return fmt.Sprintf("AI service returned an error (status %d): %s", status, detail)
	}
	return fmt.Sprintf("AI service returned an error (status %d).", status)
}

func aiProviderErrorDetail(body []byte) string {
	trimmed := strings.TrimSpace(string(body))
	if trimmed == "" {
		return ""
	}

	var openAIStyle struct {
		Error struct {
			Message string `json:"message"`
			Type    string `json:"type"`
			Code    string `json:"code"`
		} `json:"error"`
	}
	if json.Unmarshal(body, &openAIStyle) == nil {
		if detail := normalizeAIProviderDetail(openAIStyle.Error.Message, openAIStyle.Error.Code, openAIStyle.Error.Type); detail != "" {
			return detail
		}
	}

	var generic struct {
		Message string `json:"message"`
		Type    string `json:"type"`
		Code    string `json:"code"`
	}
	if json.Unmarshal(body, &generic) == nil {
		if detail := normalizeAIProviderDetail(generic.Message, generic.Code, generic.Type); detail != "" {
			return detail
		}
	}

	return normalizeAIProviderDetail(trimmed, "", "")
}

func normalizeAIProviderDetail(message, code, typ string) string {
	message = strings.Join(strings.Fields(strings.TrimSpace(message)), " ")
	code = strings.TrimSpace(code)
	typ = strings.TrimSpace(typ)

	switch {
	case message != "" && code != "":
		message = fmt.Sprintf("%s (%s)", message, code)
	case message != "" && typ != "":
		message = fmt.Sprintf("%s (%s)", message, typ)
	case message == "" && code != "":
		message = code
	case message == "" && typ != "":
		message = typ
	}

	if len(message) > 240 {
		message = message[:237] + "..."
	}
	return message
}

func normalizeKnownDBProtocol(protocol string) string {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if _, ok := knownDBProtocols[protocol]; ok {
		return protocol
	}
	return ""
}

func isMongoDBProtocol(protocol string) bool {
	return normalizeKnownDBProtocol(protocol) == "mongodb"
}

func validateGeneratedSQL(sqlText string) error {
	normalized := regexp.MustCompile(`(?m)^\s*--.*$`).ReplaceAllString(sqlText, "")
	normalized = strings.TrimSpace(normalized)
	firstWord := ""
	if fields := strings.Fields(normalized); len(fields) > 0 {
		firstWord = strings.ToUpper(fields[0])
	}
	switch firstWord {
	case "SELECT", "WITH", "(":
		return nil
	default:
		return &requestError{status: http.StatusBadRequest, message: "The AI generated a non-SELECT query. Only SELECT queries are allowed."}
	}
}

func firewallWarningValue(value *string) any {
	if value == nil {
		return nil
	}
	return *value
}

func truncateString(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit]
}
