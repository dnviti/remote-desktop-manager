package modelgatewayapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func (s Service) completeLLM(ctx context.Context, options llmCompletionOptions, overrides *llmOverrides) (llmCompletionResult, error) {
	cfg := loadAIEnvConfig()

	provider := cfg.Provider
	apiKey := cfg.APIKey
	baseURL := cfg.BaseURL
	modelID := cfg.Model
	maxTokens := cfg.MaxTokens
	temperature := cfg.Temperature
	timeout := cfg.Timeout

	if overrides != nil {
		if strings.TrimSpace(string(overrides.Provider)) != "" {
			provider = overrides.Provider
		}
		if strings.TrimSpace(overrides.APIKey) != "" {
			apiKey = strings.TrimSpace(overrides.APIKey)
		}
		if strings.TrimSpace(overrides.BaseURL) != "" {
			baseURL = strings.TrimSpace(overrides.BaseURL)
		}
		if strings.TrimSpace(overrides.Model) != "" {
			modelID = strings.TrimSpace(overrides.Model)
		}
		if overrides.MaxTokens > 0 {
			maxTokens = overrides.MaxTokens
		}
		if overrides.Temperature != nil {
			temperature = *overrides.Temperature
		}
		if overrides.Timeout > 0 {
			timeout = overrides.Timeout
		}
	}

	if options.MaxTokens > 0 {
		maxTokens = options.MaxTokens
	}
	if options.Temperature != nil {
		temperature = *options.Temperature
	}
	if strings.TrimSpace(string(provider)) == "" {
		return llmCompletionResult{}, &requestError{
			status:  http.StatusServiceUnavailable,
			message: "AI is not available. An administrator must configure an AI/LLM provider in Settings.",
		}
	}
	if modelID == "" {
		modelID = defaultModelForProvider(provider)
	}
	if modelID == "" {
		return llmCompletionResult{}, &requestError{status: http.StatusServiceUnavailable, message: "AI model is not configured and no default is available for this provider."}
	}
	if provider != contracts.AIProviderOllama && strings.TrimSpace(apiKey) == "" {
		return llmCompletionResult{}, &requestError{status: http.StatusServiceUnavailable, message: "AI API key is not configured."}
	}
	if (provider == contracts.AIProviderOllama || provider == contracts.AIProviderOpenAICompatible) && strings.TrimSpace(baseURL) == "" {
		return llmCompletionResult{}, &requestError{status: http.StatusServiceUnavailable, message: fmt.Sprintf("AI base URL is required for %s.", provider)}
	}

	if timeout <= 0 {
		timeout = 60 * time.Second
	}
	if maxTokens <= 0 {
		maxTokens = 4096
	}

	switch provider {
	case contracts.AIProviderAnthropic:
		if strings.TrimSpace(baseURL) == "" {
			baseURL = "https://api.anthropic.com"
		}
		return s.completeAnthropic(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, apiKey, timeout)
	case contracts.AIProviderOpenAI:
		if strings.TrimSpace(baseURL) == "" {
			baseURL = "https://api.openai.com"
		}
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, timeout, apiKey)
	case contracts.AIProviderOllama:
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, timeout, "")
	case contracts.AIProviderOpenAICompatible:
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, timeout, apiKey)
	default:
		return llmCompletionResult{}, &requestError{status: http.StatusServiceUnavailable, message: "AI provider is not supported."}
	}
}

func (s Service) completeAnthropic(ctx context.Context, messages []llmMessage, modelID string, maxTokens int, temperature float64, baseURL, apiKey string, timeout time.Duration) (llmCompletionResult, error) {
	systemPrompt := ""
	nonSystem := make([]map[string]string, 0, len(messages))
	for _, message := range messages {
		if message.Role == "system" {
			systemPrompt = message.Content
			continue
		}
		nonSystem = append(nonSystem, map[string]string{
			"role":    message.Role,
			"content": message.Content,
		})
	}

	body := map[string]any{
		"model":       modelID,
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"messages":    nonSystem,
	}
	if systemPrompt != "" {
		body["system"] = systemPrompt
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return llmCompletionResult{}, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if strings.HasSuffix(endpoint, "/v1") {
		endpoint += "/messages"
	} else {
		endpoint += "/v1/messages"
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return llmCompletionResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: "Failed to connect to AI service."}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: aiProviderHTTPError(resp.StatusCode, body)}
	}

	var decoded struct {
		Content []struct {
			Text string `json:"text"`
		} `json:"content"`
		Model string `json:"model"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: "Failed to decode AI service response."}
	}

	content := ""
	if len(decoded.Content) > 0 {
		content = decoded.Content[0].Text
	}
	return llmCompletionResult{Content: content, Model: decoded.Model}, nil
}

func (s Service) completeOpenAICompatible(ctx context.Context, messages []llmMessage, modelID string, maxTokens int, temperature float64, baseURL string, timeout time.Duration, apiKey string) (llmCompletionResult, error) {
	body := map[string]any{
		"model":       modelID,
		"max_tokens":  maxTokens,
		"temperature": temperature,
		"messages":    messages,
	}

	payload, err := json.Marshal(body)
	if err != nil {
		return llmCompletionResult{}, err
	}

	reqCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	switch {
	case strings.HasSuffix(endpoint, "/chat/completions"):
	case strings.HasSuffix(endpoint, "/v1"):
		endpoint += "/chat/completions"
	default:
		endpoint += "/v1/chat/completions"
	}
	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, endpoint, strings.NewReader(string(payload)))
	if err != nil {
		return llmCompletionResult{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	if strings.TrimSpace(apiKey) != "" {
		req.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: "Failed to connect to AI service."}
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: aiProviderHTTPError(resp.StatusCode, body)}
	}

	var decoded struct {
		Choices []struct {
			Message struct {
				Content string `json:"content"`
			} `json:"message"`
		} `json:"choices"`
		Model string `json:"model"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: "Failed to decode AI service response."}
	}

	content := ""
	if len(decoded.Choices) > 0 {
		content = decoded.Choices[0].Message.Content
	}
	if decoded.Model == "" {
		decoded.Model = modelID
	}
	return llmCompletionResult{Content: content, Model: decoded.Model}, nil
}
