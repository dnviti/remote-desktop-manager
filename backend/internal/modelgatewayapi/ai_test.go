package modelgatewayapi

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func TestParsePlanningResponseReadsJSONTables(t *testing.T) {
	t.Parallel()

	raw := `{"tables":[{"name":"orders","schema":"public","reason":"contains order totals"},{"name":"customers","reason":"joins buyer details"}]}`
	items := parsePlanningResponse(raw)
	if len(items) != 2 {
		t.Fatalf("expected 2 table requests, got %d", len(items))
	}
	if items[1].Schema != "" {
		t.Fatalf("expected missing schema to stay empty, got %q", items[1].Schema)
	}
}

func TestResolvePlanningRequestsUsesActualSchemaForUniqueTableNames(t *testing.T) {
	t.Parallel()

	requests := []objectRequest{
		{Name: "demo_customers", Schema: "public", Reason: "customers"},
		{Name: "arsenale_demo.demo_invoices", Reason: "invoice totals"},
	}
	schema := []contracts.SchemaTable{
		{Name: "demo_customers", Schema: "arsenale_demo"},
		{Name: "demo_invoices", Schema: "arsenale_demo"},
	}

	resolved := resolvePlanningRequests(requests, schema)
	if len(resolved) != 2 {
		t.Fatalf("expected 2 resolved requests, got %d", len(resolved))
	}
	if resolved[0].Schema != "arsenale_demo" || resolved[0].Name != "demo_customers" {
		t.Fatalf("unexpected first resolved request: %#v", resolved[0])
	}
	if resolved[1].Schema != "arsenale_demo" || resolved[1].Name != "demo_invoices" {
		t.Fatalf("unexpected second resolved request: %#v", resolved[1])
	}
}

func TestResolvePlanningRequestsFuzzyMatchesDemoPrefixedTableNames(t *testing.T) {
	t.Parallel()

	requests := []objectRequest{
		{Name: "customers", Reason: "customer records"},
		{Name: "invoices", Reason: "invoice totals"},
	}
	schema := []contracts.SchemaTable{
		{Name: "demo_customers", Schema: "arsenale_demo"},
		{Name: "demo_invoices", Schema: "arsenale_demo"},
		{Name: "demo_products", Schema: "arsenale_demo"},
	}

	resolved := resolvePlanningRequests(requests, schema)
	if len(resolved) != 2 {
		t.Fatalf("expected 2 resolved requests, got %d", len(resolved))
	}
	if resolved[0].Schema != "arsenale_demo" || resolved[0].Name != "demo_customers" {
		t.Fatalf("unexpected first resolved request: %#v", resolved[0])
	}
	if resolved[1].Schema != "arsenale_demo" || resolved[1].Name != "demo_invoices" {
		t.Fatalf("unexpected second resolved request: %#v", resolved[1])
	}
}

func TestHeuristicPlanningFallbackUsesPromptAndColumnTokens(t *testing.T) {
	t.Parallel()

	schema := []contracts.SchemaTable{
		{
			Name:   "demo_customers",
			Schema: "arsenale_demo",
			Columns: []contracts.SchemaColumn{
				{Name: "full_name"},
				{Name: "region"},
			},
		},
		{
			Name:   "demo_invoices",
			Schema: "arsenale_demo",
			Columns: []contracts.SchemaColumn{
				{Name: "customer_id"},
				{Name: "total_amount"},
			},
		},
		{
			Name:   "demo_products",
			Schema: "arsenale_demo",
			Columns: []contracts.SchemaColumn{
				{Name: "sku"},
			},
		},
	}

	resolved := heuristicPlanningFallback("show the top customers by invoice total amount", schema)
	if len(resolved) < 2 {
		t.Fatalf("expected at least 2 heuristic matches, got %d", len(resolved))
	}
	if resolved[0].Name != "demo_invoices" && resolved[0].Name != "demo_customers" {
		t.Fatalf("unexpected top heuristic result: %#v", resolved[0])
	}
	names := map[string]struct{}{}
	for _, item := range resolved {
		names[item.Name] = struct{}{}
	}
	if _, ok := names["demo_customers"]; !ok {
		t.Fatalf("expected demo_customers in heuristic results, got %#v", resolved)
	}
	if _, ok := names["demo_invoices"]; !ok {
		t.Fatalf("expected demo_invoices in heuristic results, got %#v", resolved)
	}
}

func TestNormalizePlanningIdentifierStripsCommonQuoting(t *testing.T) {
	t.Parallel()

	if got := normalizePlanningIdentifier("`demo_orders`"); got != "demo_orders" {
		t.Fatalf("unexpected normalized identifier %q", got)
	}
	if got := normalizePlanningIdentifier("[dbo]"); got != "dbo" {
		t.Fatalf("unexpected normalized identifier %q", got)
	}
}

func TestFindUnapprovedTableReferenceRejectsExtraTable(t *testing.T) {
	t.Parallel()

	approved := []contracts.SchemaTable{
		{Name: "orders", Schema: "public"},
	}
	all := []contracts.SchemaTable{
		{Name: "orders", Schema: "public"},
		{Name: "users", Schema: "public"},
	}

	violation := findUnapprovedTableReference("select * from orders join users on users.id = orders.user_id", approved, all)
	if violation != "users" {
		t.Fatalf("expected users violation, got %q", violation)
	}
}

func TestParseFirstTurnResponseFiltersUnsupportedRequests(t *testing.T) {
	t.Parallel()

	raw := `{"needs_data":true,"data_requests":[{"type":"indexes","target":"orders","reason":"inspect indexes"},{"type":"database_version","target":"db","reason":"unsupported here"}]}`
	result := parseFirstTurnResponse(raw)
	if !result.NeedsData {
		t.Fatal("expected needsData=true")
	}
	if len(result.DataRequests) != 1 {
		t.Fatalf("expected 1 supported data request, got %d", len(result.DataRequests))
	}
	if result.DataRequests[0].Type != "indexes" {
		t.Fatalf("unexpected request type %q", result.DataRequests[0].Type)
	}
}

func TestTenantLLMOverridesUsesTenantProviderConfig(t *testing.T) {
	t.Parallel()

	overrides := tenantLLMOverrides(tenantRuntimeConfig{
		Provider:            contracts.AIProviderAnthropic,
		APIKey:              "tenant-secret",
		ModelID:             "claude-sonnet-4-20250514",
		MaxTokensPerRequest: 2048,
		BaseURL:             "",
	}, aiEnvConfig{
		Temperature: 0.4,
		Timeout:     30 * time.Second,
	})
	if overrides == nil {
		t.Fatal("expected tenant overrides")
	}
	if overrides.Provider != contracts.AIProviderAnthropic {
		t.Fatalf("unexpected provider %q", overrides.Provider)
	}
	if overrides.APIKey != "tenant-secret" {
		t.Fatalf("unexpected api key %q", overrides.APIKey)
	}
	if overrides.MaxTokens != 2048 {
		t.Fatalf("unexpected max tokens %d", overrides.MaxTokens)
	}
	if overrides.Timeout != 30*time.Second {
		t.Fatalf("unexpected timeout %s", overrides.Timeout)
	}
}

func TestTenantLLMOverridesRequiresConfiguredSecretsAndBaseURL(t *testing.T) {
	t.Parallel()

	if overrides := tenantLLMOverrides(tenantRuntimeConfig{
		Provider: contracts.AIProviderOpenAI,
	}, aiEnvConfig{}); overrides != nil {
		t.Fatal("expected nil overrides when api key is missing")
	}

	if overrides := tenantLLMOverrides(tenantRuntimeConfig{
		Provider: contracts.AIProviderOllama,
		ModelID:  "llama3.1:8b",
	}, aiEnvConfig{}); overrides != nil {
		t.Fatal("expected nil overrides when base URL is missing")
	}
}

func TestEffectiveLLMProviderAndModelPrefersTenantOverrides(t *testing.T) {
	t.Parallel()

	provider, modelID := effectiveLLMProviderAndModel(&llmOverrides{
		Provider: contracts.AIProviderAnthropic,
	}, aiEnvConfig{
		Provider: contracts.AIProviderOpenAI,
		Model:    "gpt-4o",
	})
	if provider != "anthropic" {
		t.Fatalf("unexpected provider %q", provider)
	}
	if modelID != "gpt-4o" {
		t.Fatalf("expected env model fallback, got %q", modelID)
	}
}

func TestAIProviderHTTPErrorIncludesQuotaGuidance(t *testing.T) {
	t.Parallel()

	message := aiProviderHTTPError(http.StatusTooManyRequests, []byte(`{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}`))
	if !strings.Contains(message, "rate limit or quota exceeded") {
		t.Fatalf("expected quota guidance, got %q", message)
	}
	if !strings.Contains(message, "insufficient_quota") {
		t.Fatalf("expected upstream detail in message, got %q", message)
	}
}

func TestContinueOptimizationReturnsProviderErrorOnSecondTurn(t *testing.T) {
	t.Parallel()

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"error":{"message":"You exceeded your current quota, please check your plan and billing details.","type":"insufficient_quota","code":"insufficient_quota"}}`))
	}))
	defer server.Close()

	state := NewAIState()
	state.optimizationSessions["conv-1"] = optimizationConversation{
		ID:       "conv-1",
		UserID:   "user-1",
		TenantID: "tenant-1",
		Input: optimizeQueryInput{
			SQL:       "SELECT * FROM demo_customers LIMIT 100;",
			SessionID: "session-1",
		},
		Messages: []llmMessage{
			{Role: "system", Content: "You are a SQL optimizer."},
			{Role: "user", Content: "Optimize this query."},
		},
		Overrides: &llmOverrides{
			Provider:  contracts.AIProviderOpenAICompatible,
			APIKey:    "test-key",
			Model:     "test-model",
			BaseURL:   server.URL,
			MaxTokens: 128,
			Timeout:   time.Second,
		},
		CreatedAt: time.Now().UTC(),
	}

	service := Service{AIState: state}
	_, err := service.continueOptimization(
		context.Background(),
		"conv-1",
		map[string]any{"indexes_demo_customers": map[string]any{"ok": true}},
		"user-1",
		"tenant-1",
		"127.0.0.1",
	)
	if err == nil {
		t.Fatal("expected provider error")
	}
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %T", err)
	}
	if reqErr.status != http.StatusBadGateway {
		t.Fatalf("unexpected status %d", reqErr.status)
	}
	if !strings.Contains(reqErr.message, "rate limit or quota exceeded") {
		t.Fatalf("expected upstream provider detail, got %q", reqErr.message)
	}
	if _, ok := state.optimizationSessions["conv-1"]; !ok {
		t.Fatal("expected optimization session to remain available for retry")
	}
}
