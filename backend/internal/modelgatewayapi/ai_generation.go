package modelgatewayapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
)

func (s Service) analyzeQueryIntent(ctx context.Context, params analyzeQueryIntentParams) (aiAnalyzeResult, error) {
	platform, err := s.loadPlatformConfig(ctx, params.TenantID)
	if err != nil {
		return aiAnalyzeResult{}, err
	}
	execution, err := resolveFeatureExecution(platform, params.AIContext, "query-generation")
	if err != nil {
		return aiAnalyzeResult{}, err
	}
	if !execution.Enabled {
		return aiAnalyzeResult{}, &requestError{status: http.StatusForbidden, message: "AI query generation is not enabled"}
	}

	overrides := llmOverridesFromExecution(execution)
	if err := s.incrementDailyCounter(ctx, params.TenantID, execution.DailyRequestLimit); err != nil {
		return aiAnalyzeResult{}, err
	}

	raw, err := s.completeLLM(ctx, llmCompletionOptions{
		Messages: []llmMessage{
			{Role: "system", Content: buildPlanningSystemPrompt(params.DBProtocol)},
			{Role: "user", Content: formatTableList(params.Schema, params.DBProtocol) + "\n\nDatabase type: " + params.DBProtocol + "\n\nUser request: " + params.Prompt},
		},
	}, overrides)
	if err != nil {
		return aiAnalyzeResult{}, err
	}

	requests := parsePlanningResponse(raw.Content)
	filtered := resolvePlanningRequests(requests, params.Schema)
	if len(filtered) == 0 {
		filtered = heuristicPlanningFallback(params.Prompt, params.Schema)
	}
	if len(filtered) == 0 {
		return aiAnalyzeResult{}, &requestError{status: http.StatusBadRequest, message: "The AI could not identify any relevant tables for your request. Try rephrasing."}
	}

	conversationID := uuid.NewString()
	state := s.ensureAIState()
	now := time.Now().UTC()
	state.mu.Lock()
	pruneGenerationLocked(state, now)
	state.generationConversations[conversationID] = generationConversation{
		ID:         conversationID,
		UserID:     params.UserID,
		TenantID:   params.TenantID,
		Prompt:     params.Prompt,
		DBProtocol: params.DBProtocol,
		FullSchema: cloneSchemaTables(params.Schema),
		Overrides:  overrides,
		AIContext:  params.AIContext,
		IPAddress:  params.IPAddress,
		CreatedAt:  now,
	}
	state.mu.Unlock()

	return aiAnalyzeResult{
		Status:         "pending_approval",
		ConversationID: conversationID,
		ObjectRequests: filtered,
	}, nil
}

func (s Service) confirmAndGenerate(ctx context.Context, conversationID string, approvedObjects []string, userID, tenantID, ipAddress string) (aiGenerateResult, error) {
	state := s.ensureAIState()
	state.mu.Lock()
	pruneGenerationLocked(state, time.Now().UTC())
	conv, ok := state.generationConversations[conversationID]
	if ok {
		delete(state.generationConversations, conversationID)
	}
	state.mu.Unlock()
	if !ok {
		return aiGenerateResult{}, &requestError{status: http.StatusNotFound, message: "Conversation expired or not found. Please start a new query."}
	}
	if conv.UserID != userID || conv.TenantID != tenantID {
		return aiGenerateResult{}, &requestError{status: http.StatusForbidden, message: "Unauthorized"}
	}

	approvedSet := make(map[string]struct{}, len(approvedObjects)*2)
	for _, value := range approvedObjects {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		approvedSet[strings.ToLower(value)] = struct{}{}
	}

	filteredSchema := make([]contracts.SchemaTable, 0, len(conv.FullSchema))
	for _, table := range conv.FullSchema {
		qualified := strings.ToLower(table.Schema + "." + table.Name)
		unqualified := strings.ToLower(table.Name)
		if _, ok := approvedSet[qualified]; ok {
			filteredSchema = append(filteredSchema, table)
			continue
		}
		if _, ok := approvedSet[unqualified]; ok {
			filteredSchema = append(filteredSchema, table)
		}
	}
	if len(filteredSchema) == 0 {
		return aiGenerateResult{}, &requestError{status: http.StatusBadRequest, message: "No tables were approved. Cannot generate a query."}
	}

	systemPrompt := buildGenerationSystemPrompt(conv.DBProtocol)
	schemaContext := formatSchemaContext(filteredSchema, conv.DBProtocol)
	userPrompt := schemaContext + "\n\nUser request: " + conv.Prompt

	result, err := s.completeLLM(ctx, llmCompletionOptions{
		Messages: []llmMessage{
			{Role: "system", Content: systemPrompt},
			{Role: "user", Content: userPrompt},
		},
	}, conv.Overrides)
	if err != nil {
		return aiGenerateResult{}, err
	}

	parsed := parseGenerationResponse(result.Content)
	normalizedQuery, err := normalizeQueryForProtocol(conv.DBProtocol, parsed.SQL, true)
	if err != nil {
		return aiGenerateResult{}, err
	}
	parsed.SQL = normalizedQuery

	if violation := findUnapprovedTableReference(parsed.SQL, filteredSchema, conv.FullSchema); violation != "" {
		deniedTables := collectDeniedTables(filteredSchema, conv.FullSchema)
		retryPrompt := schemaContext + "\n\nIMPORTANT: You MUST NOT reference these denied tables: " + strings.Join(deniedTables, ", ") + "\n\nUser request: " + conv.Prompt
		retry, retryErr := s.completeLLM(ctx, llmCompletionOptions{
			Messages: []llmMessage{
				{Role: "system", Content: systemPrompt},
				{Role: "user", Content: retryPrompt},
			},
		}, conv.Overrides)
		if retryErr != nil {
			return aiGenerateResult{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("The AI used unapproved table %q. Only these tables were approved: %s. Try approving more tables or rephrasing your request.", violation, strings.Join(approvedObjects, ", "))}
		}
		parsed = parseGenerationResponse(retry.Content)
		normalizedQuery, err = normalizeQueryForProtocol(conv.DBProtocol, parsed.SQL, true)
		if err != nil {
			return aiGenerateResult{}, err
		}
		parsed.SQL = normalizedQuery
		if retryViolation := findUnapprovedTableReference(parsed.SQL, filteredSchema, conv.FullSchema); retryViolation != "" {
			return aiGenerateResult{}, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("The AI used unapproved table %q. Only these tables were approved: %s. Try approving more tables or rephrasing your request.", retryViolation, strings.Join(approvedObjects, ", "))}
		}
	}

	var firewallWarning *string
	if evaluation, err := s.evaluateFirewallForAIContext(ctx, tenantID, conv.AIContext, parsed.SQL, conv.AIContext.DatabaseName, ""); err == nil && evaluation.Matched {
		switch evaluation.Action {
		case "BLOCK":
			message := "Firewall would block: " + evaluation.RuleName
			firewallWarning = &message
		default:
			message := "Firewall alert: " + evaluation.RuleName
			firewallWarning = &message
		}
	}

	provider, modelID := providerAndModelFromOverrides(conv.Overrides)

	_ = s.insertAuditLog(ctx, userID, "AI_QUERY_GENERATED", "DatabaseQuery", tenantID, map[string]any{
		"prompt":          truncateString(conv.Prompt, 200),
		"generatedSql":    parsed.SQL,
		"approvedTables":  approvedObjects,
		"provider":        provider,
		"model":           modelID,
		"tenantId":        tenantID,
		"firewallWarning": firewallWarningValue(firewallWarning),
	}, ipAddress)

	return aiGenerateResult{
		Status:          "complete",
		SQL:             parsed.SQL,
		Explanation:     parsed.Explanation,
		FirewallWarning: firewallWarning,
	}, nil
}

func (s Service) fetchSchemaForAI(ctx context.Context, userID, tenantID, sessionID string) ([]contracts.SchemaTable, string) {
	if s.DatabaseSessions.Store == nil {
		return nil, ""
	}

	tables, dbProtocol, err := s.DatabaseSessions.FetchOwnedSchemaTables(ctx, userID, tenantID, sessionID)
	if err != nil {
		return nil, dbProtocol
	}
	return tables, dbProtocol
}
