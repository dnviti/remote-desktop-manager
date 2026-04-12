package modelgatewayapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/queryrunner"
	"github.com/google/uuid"
)

func (s Service) optimizeQuery(ctx context.Context, input optimizeQueryInput, userID, tenantID, ipAddress string) (optimizeQueryResult, error) {
	aiContext, err := s.DatabaseSessions.ResolveOwnedAIContext(ctx, userID, tenantID, input.SessionID)
	if err != nil {
		return optimizeQueryResult{}, err
	}
	platform, err := s.loadPlatformConfig(ctx, tenantID)
	if err != nil {
		return optimizeQueryResult{}, err
	}
	execution, err := resolveFeatureExecution(platform, aiContext, "query-optimizer")
	if err != nil {
		return optimizeQueryResult{}, err
	}
	if !execution.Enabled {
		return optimizeQueryResult{}, &requestError{
			status:  http.StatusForbidden,
			message: "AI query optimization is not enabled",
		}
	}
	overrides := llmOverridesFromExecution(execution)

	conversationID := uuid.NewString()
	messages := []llmMessage{
		{Role: "system", Content: buildOptimizationSystemPrompt(input.DBProtocol)},
		{Role: "user", Content: buildFirstTurnMessage(input)},
	}

	raw, err := s.completeLLM(ctx, llmCompletionOptions{Messages: messages}, overrides)
	var parsed firstTurnResponse
	if err != nil {
		parsed = buildHeuristicDataRequests(input)
	} else {
		parsed = parseFirstTurnResponse(raw.Content)
	}

	state := s.ensureAIState()
	now := time.Now().UTC()
	state.mu.Lock()
	pruneOptimizationLocked(state, now)
	state.optimizationSessions[conversationID] = optimizationConversation{
		ID:           conversationID,
		UserID:       userID,
		TenantID:     tenantID,
		Input:        input,
		Rounds:       0,
		ApprovedData: map[string]any{},
		Messages:     append([]llmMessage(nil), messages...),
		Overrides:    overrides,
		CreatedAt:    now,
	}
	state.mu.Unlock()

	provider, modelID := providerAndModelFromOverrides(overrides)
	_ = s.insertAuditLog(ctx, userID, "DB_QUERY_AI_OPTIMIZED", "DatabaseQuery", input.SessionID, map[string]any{
		"conversationId":   conversationID,
		"phase":            "initial",
		"provider":         provider,
		"model":            modelID,
		"dataRequestCount": len(parsed.DataRequests),
		"dataRequestTypes": collectDataRequestTypes(parsed.DataRequests),
	}, ipAddress)

	if !parsed.NeedsData {
		state.mu.Lock()
		delete(state.optimizationSessions, conversationID)
		state.mu.Unlock()
		optimizedSQL := parsed.OptimizedSQL
		explanation := parsed.Explanation
		if optimizedSQL == "" {
			optimizedSQL = input.SQL
		}
		if normalized, normErr := normalizeQueryForProtocol(input.DBProtocol, optimizedSQL, true); normErr == nil {
			optimizedSQL = normalized
		}
		if isMongoDBProtocol(input.DBProtocol) {
			if stabilized, changed, stabErr := stabilizeMongoOptimizedQuery(input.SQL, optimizedSQL); stabErr == nil {
				optimizedSQL = stabilized
				if changed {
					explanation = appendMongoSemanticsNote(explanation)
				}
			}
		}
		if explanation == "" {
			explanation = "No optimization opportunities identified."
		}
		return optimizeQueryResult{
			Status:         "complete",
			ConversationID: conversationID,
			OptimizedSQL:   optimizedSQL,
			Explanation:    explanation,
			Changes:        parsed.Changes,
		}, nil
	}

	return optimizeQueryResult{
		Status:         "needs_data",
		ConversationID: conversationID,
		DataRequests:   parsed.DataRequests,
	}, nil
}

func (s Service) continueOptimization(ctx context.Context, conversationID string, approvedData map[string]any, userID, tenantID, ipAddress string) (optimizeQueryResult, error) {
	state := s.ensureAIState()
	state.mu.Lock()
	pruneOptimizationLocked(state, time.Now().UTC())
	conversation, ok := state.optimizationSessions[conversationID]
	state.mu.Unlock()
	if !ok {
		return optimizeQueryResult{}, &requestError{status: http.StatusNotFound, message: "Conversation not found or expired."}
	}
	if conversation.UserID != userID || conversation.TenantID != tenantID {
		return optimizeQueryResult{}, &requestError{status: http.StatusNotFound, message: "Conversation not found or expired."}
	}

	conversation.Rounds++
	if conversation.ApprovedData == nil {
		conversation.ApprovedData = map[string]any{}
	}
	for key, value := range approvedData {
		conversation.ApprovedData[key] = value
	}

	messages := append([]llmMessage{}, conversation.Messages...)
	messages = append(messages,
		llmMessage{Role: "assistant", Content: `{"needs_data": true, "data_requests": [...]}`},
		llmMessage{Role: "user", Content: buildSecondTurnMessage(approvedData)},
	)

	raw, err := s.completeLLM(ctx, llmCompletionOptions{Messages: messages}, conversation.Overrides)
	if err != nil {
		return optimizeQueryResult{}, err
	}
	parsed := parseSecondTurnResponse(raw.Content, conversation.Input.SQL)
	if normalized, normErr := normalizeQueryForProtocol(conversation.Input.DBProtocol, parsed.OptimizedSQL, true); normErr == nil {
		parsed.OptimizedSQL = normalized
	}
	if isMongoDBProtocol(conversation.Input.DBProtocol) {
		if stabilized, changed, stabErr := stabilizeMongoOptimizedQuery(conversation.Input.SQL, parsed.OptimizedSQL); stabErr == nil {
			parsed.OptimizedSQL = stabilized
			if changed {
				parsed.Explanation = appendMongoSemanticsNote(parsed.Explanation)
			}
		}
	}

	provider, modelID := providerAndModelFromOverrides(conversation.Overrides)
	_ = s.insertAuditLog(ctx, userID, "DB_QUERY_AI_OPTIMIZED", "DatabaseQuery", conversation.Input.SessionID, map[string]any{
		"conversationId":   conversationID,
		"phase":            "continue",
		"round":            conversation.Rounds,
		"provider":         provider,
		"model":            modelID,
		"approvedDataKeys": mapKeys(approvedData),
	}, ipAddress)

	state.mu.Lock()
	delete(state.optimizationSessions, conversationID)
	state.mu.Unlock()

	return optimizeQueryResult{
		Status:         "complete",
		ConversationID: conversationID,
		OptimizedSQL:   parsed.OptimizedSQL,
		Explanation:    parsed.Explanation,
		Changes:        parsed.Changes,
	}, nil
}

func buildOptimizationSystemPrompt(dbProtocol string) string {
	if isMongoDBProtocol(dbProtocol) {
		return `You are an expert MongoDB query analyst and optimizer.
Your task is to analyze Arsenale MongoDB JSON query specs and produce optimized read-only versions.

You work in a multi-turn flow:
1. FIRST TURN: You receive a MongoDB query spec and optional metadata. Analyze it and request specific collection metadata you need (indexes, statistics, table_schema, row_count). Respond ONLY with a JSON object.
2. SECOND TURN: You receive the requested metadata. Produce the optimized query with explanation. Respond ONLY with a JSON object.

FIRST TURN response format (when you need additional data):
{
  "needs_data": true,
  "data_requests": [
    { "type": "indexes|statistics|table_schema|row_count", "target": "collection_name", "reason": "brief reason" }
  ]
}

FIRST TURN response format (when you can optimize immediately):
{
  "needs_data": false,
  "optimized_query": {
    "collection": "collection_name",
    "operation": "find|aggregate|count|distinct|runCommand"
  },
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

SECOND TURN response format:
{
  "optimized_query": {
    "collection": "collection_name",
    "operation": "find|aggregate|count|distinct|runCommand"
  },
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

Rules:
- Only suggest read-only MongoDB operations.
- ALWAYS include an explicit "operation" field in the optimized query.
- Use the bare collection name in "collection"; do not prefix it with database or schema names like "arsenale_demo.demo_customers".
- Only use a separate "database" field when it is genuinely required.
- Never change the query semantics.
- Prefer the simplest valid query shape for the requested result.
- If the query is already optimal, return the original query unchanged and explain why.
- Respond ONLY with valid JSON, no markdown fences or extra text.`
	}

	return `You are an expert SQL performance analyst and query optimizer.
Your task is to analyze SQL queries and their execution plans, then produce optimized versions.

You work in a multi-turn flow:
1. FIRST TURN: You receive a SQL query and execution plan. Analyze them and request specific database metadata you need (indexes, statistics, foreign keys). Respond ONLY with a JSON object.
2. SECOND TURN: You receive the requested metadata. Produce the optimized query with explanation. Respond ONLY with a JSON object.

FIRST TURN response format (when you need additional data):
{
  "needs_data": true,
  "data_requests": [
    { "type": "indexes|statistics|foreign_keys", "target": "table_name", "reason": "brief reason" }
  ]
}

FIRST TURN response format (when you can optimize immediately):
{
  "needs_data": false,
  "optimized_sql": "SELECT ...",
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

SECOND TURN response format:
{
  "optimized_sql": "SELECT ...",
  "explanation": "Explanation of changes...",
  "changes": ["change 1", "change 2"]
}

Rules:
- Only suggest changes you are confident will improve performance.
- If the query is already optimal, set optimized_sql to the original query and explain why.
- Never suggest changes that alter query semantics (same results, same ordering).
- Consider the specific database engine and version provided.
- Be specific in your explanations (mention index names, cardinality, join strategies).
- Respond ONLY with valid JSON, no markdown fences or extra text.`
}

func buildFirstTurnMessage(input optimizeQueryInput) string {
	parts := []string{"Database: " + input.DBProtocol}
	if strings.TrimSpace(input.DBVersion) != "" {
		parts[0] += " " + strings.TrimSpace(input.DBVersion)
	}
	queryLabel := "SQL Query"
	if isMongoDBProtocol(input.DBProtocol) {
		queryLabel = "MongoDB Query Spec"
	}
	parts = append(parts, "", queryLabel+":", input.SQL)
	if input.ExecutionPlan != nil {
		planLabel := "Execution Plan"
		if isMongoDBProtocol(input.DBProtocol) {
			planLabel = "Query Plan"
		}
		plan := stringifyLLMContext(input.ExecutionPlan)
		if len(plan) > 50000 {
			plan = plan[:50000] + "\n[truncated]"
		}
		parts = append(parts, "", planLabel+":", plan)
	}
	if input.SchemaContext != nil {
		parts = append(parts, "", "Schema Context:", stringifyLLMContext(input.SchemaContext))
	}
	return strings.Join(parts, "\n")
}

func buildSecondTurnMessage(approvedData map[string]any) string {
	return "Here is the database metadata you requested:\n\n" + stringifyLLMContext(approvedData) + "\n\nBased on this data, produce the optimized query."
}

func stringifyLLMContext(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	default:
		payload, _ := json.MarshalIndent(value, "", "  ")
		return string(payload)
	}
}

func extractJSON(text string) (any, error) {
	var direct any
	if err := json.Unmarshal([]byte(text), &direct); err == nil {
		return direct, nil
	}

	if match := regexp.MustCompile("(?is)```(?:json)?\\s*(.*?)```").FindStringSubmatch(text); len(match) == 2 {
		var fenced any
		if err := json.Unmarshal([]byte(strings.TrimSpace(match[1])), &fenced); err == nil {
			return fenced, nil
		}
	}

	if match := regexp.MustCompile(`(?s)\{.*\}`).FindString(text); strings.TrimSpace(match) != "" {
		var embedded any
		if err := json.Unmarshal([]byte(match), &embedded); err == nil {
			return embedded, nil
		}
	}

	return nil, &requestError{status: http.StatusBadGateway, message: "AI returned an invalid response format."}
}

func parseFirstTurnResponse(content string) firstTurnResponse {
	extracted, err := extractJSON(content)
	if err != nil {
		return firstTurnResponse{}
	}
	root, ok := extracted.(map[string]any)
	if !ok {
		return firstTurnResponse{}
	}

	if needsData, _ := root["needs_data"].(bool); needsData {
		rawItems, _ := root["data_requests"].([]any)
		requests := make([]dataRequest, 0, len(rawItems))
		for _, item := range rawItems {
			record, ok := item.(map[string]any)
			if !ok {
				continue
			}
			reqType, _ := record["type"].(string)
			target, _ := record["target"].(string)
			reason, _ := record["reason"].(string)
			reqType = strings.TrimSpace(reqType)
			target = strings.TrimSpace(target)
			reason = strings.TrimSpace(reason)
			if reqType == "" || target == "" || reason == "" {
				continue
			}
			if _, ok := validOptimizationIntrospectionTypes[reqType]; !ok {
				continue
			}
			requests = append(requests, dataRequest{Type: reqType, Target: target, Reason: reason})
		}
		if len(requests) > 0 {
			return firstTurnResponse{NeedsData: true, DataRequests: requests}
		}
	}

	result := firstTurnResponse{}
	if value := extractQueryTextValue(root["optimized_sql"]); value != "" {
		result.OptimizedSQL = value
	} else if value := extractQueryTextValue(root["optimized_query"]); value != "" {
		result.OptimizedSQL = value
	}
	if value, ok := root["explanation"].(string); ok {
		result.Explanation = value
	}
	if items, ok := root["changes"].([]any); ok {
		for _, item := range items {
			if value, ok := item.(string); ok {
				result.Changes = append(result.Changes, value)
			}
		}
	}
	return result
}

func parseSecondTurnResponse(content, originalSQL string) secondTurnResponse {
	extracted, err := extractJSON(content)
	if err != nil {
		return secondTurnResponse{
			OptimizedSQL: originalSQL,
			Explanation:  "Analysis complete. The query appears to be reasonably optimized.",
			Changes:      []string{},
		}
	}
	root, ok := extracted.(map[string]any)
	if !ok {
		return secondTurnResponse{
			OptimizedSQL: originalSQL,
			Explanation:  "Analysis complete. The query appears to be reasonably optimized.",
			Changes:      []string{},
		}
	}

	result := secondTurnResponse{
		OptimizedSQL: originalSQL,
		Explanation:  "Analysis complete. The query appears to be reasonably optimized.",
		Changes:      []string{},
	}
	if value := extractQueryTextValue(root["optimized_sql"]); value != "" {
		result.OptimizedSQL = value
	} else if value := extractQueryTextValue(root["optimized_query"]); value != "" {
		result.OptimizedSQL = value
	}
	if value, ok := root["explanation"].(string); ok && strings.TrimSpace(value) != "" {
		result.Explanation = strings.TrimSpace(value)
	}
	if items, ok := root["changes"].([]any); ok {
		for _, item := range items {
			if value, ok := item.(string); ok {
				result.Changes = append(result.Changes, value)
			}
		}
	}
	return result
}

func buildHeuristicDataRequests(input optimizeQueryInput) firstTurnResponse {
	if isMongoDBProtocol(input.DBProtocol) {
		collections := extractCollectionsFromMongoQuery(input.SQL)
		requests := make([]dataRequest, 0, len(collections)*3)
		for _, collection := range collections {
			requests = append(requests, dataRequest{
				Type:   "indexes",
				Target: collection,
				Reason: fmt.Sprintf("Inspect indexes on `%s` to identify query-shape improvements", collection),
			})
			requests = append(requests, dataRequest{
				Type:   "statistics",
				Target: collection,
				Reason: fmt.Sprintf("Read collection statistics for `%s` to understand scan cost", collection),
			})
			requests = append(requests, dataRequest{
				Type:   "table_schema",
				Target: collection,
				Reason: fmt.Sprintf("Inspect sampled schema for `%s` to validate field usage", collection),
			})
		}
		if len(requests) == 0 {
			return firstTurnResponse{}
		}
		return firstTurnResponse{NeedsData: true, DataRequests: requests}
	}

	tables := extractTablesFromSQL(input.SQL)
	requests := make([]dataRequest, 0, len(tables)*2)
	for _, table := range tables {
		requests = append(requests, dataRequest{
			Type:   "indexes",
			Target: table,
			Reason: fmt.Sprintf("Inspect indexes on `%s` to identify missing index opportunities", table),
		})
		requests = append(requests, dataRequest{
			Type:   "statistics",
			Target: table,
			Reason: fmt.Sprintf("Read column statistics for `%s` to understand data distribution", table),
		})
	}
	if len(tables) > 1 {
		limit := len(tables)
		if limit > 3 {
			limit = 3
		}
		for _, table := range tables[:limit] {
			requests = append(requests, dataRequest{
				Type:   "foreign_keys",
				Target: table,
				Reason: fmt.Sprintf("Check foreign key relationships on `%s` for join optimization", table),
			})
		}
	}
	if len(requests) == 0 {
		return firstTurnResponse{}
	}
	return firstTurnResponse{NeedsData: true, DataRequests: requests}
}

func extractCollectionsFromMongoQuery(queryText string) []string {
	_, collection, err := queryrunner.ParseMongoQueryMetadata(queryText)
	if err != nil || strings.TrimSpace(collection) == "" {
		return nil
	}
	return []string{strings.TrimSpace(collection)}
}

func extractTablesFromSQL(sqlText string) []string {
	pattern := regexp.MustCompile(`(?i)(?:FROM|JOIN)\s+(?:` + "`" + `|"|')?(\w+)(?:` + "`" + `|"|')?`)
	matches := pattern.FindAllStringSubmatch(sqlText, -1)
	seen := map[string]struct{}{}
	var tables []string
	for _, match := range matches {
		if len(match) != 2 {
			continue
		}
		name := strings.TrimSpace(match[1])
		if name == "" {
			continue
		}
		if _, ok := seen[name]; ok {
			continue
		}
		seen[name] = struct{}{}
		tables = append(tables, name)
	}
	return tables
}

func collectDataRequestTypes(requests []dataRequest) []string {
	items := make([]string, 0, len(requests))
	for _, item := range requests {
		items = append(items, item.Type+":"+item.Target)
	}
	return items
}

func mapKeys(values map[string]any) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	return keys
}
