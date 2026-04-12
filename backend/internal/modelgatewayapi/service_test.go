package modelgatewayapi

import (
	"errors"
	"testing"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestBuildConfigResponseOmitsEmptyBaseURLAsNull(t *testing.T) {
	t.Parallel()

	response := buildConfigResponse(
		storedAIConfig{
			QueryGeneration: storedAIFeature{
				Enabled:             true,
				Backend:             "primary",
				ModelID:             "gpt-4o",
				MaxTokensPerRequest: 2048,
				DailyRequestLimit:   25,
			},
			QueryOptimizer: storedAIFeature{
				Enabled:             true,
				Backend:             "primary",
				ModelID:             "gpt-4o-mini",
				MaxTokensPerRequest: 2048,
			},
			Temperature: 0.2,
			TimeoutMS:   60000,
		},
		[]storedAIBackend{{
			Name:         "primary",
			Provider:     contracts.AIProviderOpenAI,
			DefaultModel: "gpt-4o",
		}},
		legacyConfigRow{},
	)

	if response.BaseURL != nil {
		t.Fatalf("expected nil baseUrl, got %q", *response.BaseURL)
	}
	if response.Provider != contracts.AIProviderOpenAI {
		t.Fatalf("unexpected provider %q", response.Provider)
	}
}

func TestClassifyConfigErrorMapsUnknownJSONFieldToBadRequest(t *testing.T) {
	t.Parallel()

	err := classifyConfigError(errors.New(`json: unknown field "extra"`))
	reqErr, ok := err.(*requestError)
	if !ok {
		t.Fatalf("expected requestError, got %T", err)
	}
	if reqErr.status != 400 {
		t.Fatalf("unexpected status %d", reqErr.status)
	}
}

func TestClassifyConfigErrorMapsValidationFailureToBadRequest(t *testing.T) {
	t.Parallel()

	err := classifyConfigError(errors.New(`backend "primary" requires baseUrl`))
	reqErr, ok := err.(*requestError)
	if !ok {
		t.Fatalf("expected requestError, got %T", err)
	}
	if reqErr.status != 400 {
		t.Fatalf("unexpected status %d", reqErr.status)
	}
}

func TestRoleAtLeast(t *testing.T) {
	t.Parallel()

	if !roleAtLeast("OWNER", "ADMIN") {
		t.Fatal("expected OWNER to satisfy ADMIN")
	}
	if roleAtLeast("MEMBER", "ADMIN") {
		t.Fatal("did not expect MEMBER to satisfy ADMIN")
	}
}
