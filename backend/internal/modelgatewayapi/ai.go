package modelgatewayapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/dnviti/arsenale/backend/internal/queryrunner"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/google/uuid"
)

var knownDBProtocols = map[string]struct{}{
	"postgresql": {},
	"mysql":      {},
	"mongodb":    {},
	"oracle":     {},
	"mssql":      {},
	"db2":        {},
}

var validOptimizationIntrospectionTypes = map[string]struct{}{
	"indexes":      {},
	"statistics":   {},
	"foreign_keys": {},
	"table_schema": {},
	"row_count":    {},
}

type aiState struct {
	mu                      sync.Mutex
	generationConversations map[string]generationConversation
	optimizationSessions    map[string]optimizationConversation
}

type generationConversation struct {
	ID         string
	UserID     string
	TenantID   string
	Prompt     string
	DBProtocol string
	FullSchema []contracts.SchemaTable
	Overrides  *llmOverrides
	IPAddress  string
	CreatedAt  time.Time
}

type optimizationConversation struct {
	ID           string
	UserID       string
	TenantID     string
	Input        optimizeQueryInput
	Rounds       int
	ApprovedData map[string]any
	Messages     []llmMessage
	Overrides    *llmOverrides
	CreatedAt    time.Time
}

type llmMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type llmCompletionOptions struct {
	Messages    []llmMessage
	MaxTokens   int
	Temperature float64
}

type llmCompletionResult struct {
	Content string
	Model   string
}

type llmOverrides struct {
	Provider    contracts.AIProviderID
	APIKey      string
	Model       string
	BaseURL     string
	MaxTokens   int
	Temperature float64
	Timeout     time.Duration
}

type aiEnvConfig struct {
	Provider               contracts.AIProviderID
	APIKey                 string
	Model                  string
	BaseURL                string
	MaxTokens              int
	Temperature            float64
	Timeout                time.Duration
	QueryGenerationEnabled bool
	QueryGenerationModel   string
	MaxRequestsPerDay      int
}

type tenantRuntimeConfig struct {
	Provider            contracts.AIProviderID
	APIKey              string
	ModelID             string
	BaseURL             string
	MaxTokensPerRequest int
	DailyRequestLimit   int
	Enabled             bool
}

type aiAnalyzeRequest struct {
	Prompt     string `json:"prompt"`
	SessionID  string `json:"sessionId"`
	DBProtocol string `json:"dbProtocol,omitempty"`
}

type objectRequest struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Reason string `json:"reason"`
}

type aiAnalyzeResult struct {
	Status         string          `json:"status"`
	ConversationID string          `json:"conversationId"`
	ObjectRequests []objectRequest `json:"objectRequests"`
}

type aiConfirmRequest struct {
	ConversationID  string   `json:"conversationId"`
	ApprovedObjects []string `json:"approvedObjects"`
}

type aiGenerateResult struct {
	Status          string  `json:"status"`
	SQL             string  `json:"sql"`
	Explanation     string  `json:"explanation"`
	FirewallWarning *string `json:"firewallWarning,omitempty"`
}

type optimizeQueryRequest struct {
	SQL           string `json:"sql"`
	ExecutionPlan any    `json:"executionPlan"`
	SessionID     string `json:"sessionId"`
	DBProtocol    string `json:"dbProtocol"`
	DBVersion     string `json:"dbVersion,omitempty"`
	SchemaContext any    `json:"schemaContext"`
}

type optimizeQueryInput struct {
	SQL           string
	ExecutionPlan any
	SessionID     string
	DBProtocol    string
	DBVersion     string
	SchemaContext any
}

type dataRequest struct {
	Type   string `json:"type"`
	Target string `json:"target"`
	Reason string `json:"reason"`
}

type optimizeQueryResult struct {
	Status         string        `json:"status"`
	ConversationID string        `json:"conversationId"`
	DataRequests   []dataRequest `json:"dataRequests,omitempty"`
	OptimizedSQL   string        `json:"optimizedSql,omitempty"`
	Explanation    string        `json:"explanation,omitempty"`
	Changes        []string      `json:"changes,omitempty"`
}

type continueOptimizationRequest struct {
	ConversationID string         `json:"conversationId"`
	ApprovedData   map[string]any `json:"approvedData"`
}

type firstTurnResponse struct {
	NeedsData    bool          `json:"needs_data"`
	DataRequests []dataRequest `json:"data_requests,omitempty"`
	OptimizedSQL string        `json:"optimized_sql,omitempty"`
	Explanation  string        `json:"explanation,omitempty"`
	Changes      []string      `json:"changes,omitempty"`
}

type secondTurnResponse struct {
	OptimizedSQL string   `json:"optimized_sql"`
	Explanation  string   `json:"explanation"`
	Changes      []string `json:"changes"`
}

type firewallRuleRecord struct {
	Name        string
	Pattern     string
	Action      string
	Scope       sql.NullString
	Description sql.NullString
	Enabled     bool
	Priority    int
}

type firewallEvaluation struct {
	Allowed   bool
	Action    string
	RuleName  string
	Matched   bool
	RuleScope string
}

type builtinFirewallPattern struct {
	Name    string
	Pattern string
	Action  string
}

var builtinFirewallPatterns = []builtinFirewallPattern{
	{Name: "Drop Table", Pattern: `\bDROP\s+TABLE\b`, Action: "BLOCK"},
	{Name: "Truncate", Pattern: `\bTRUNCATE\b`, Action: "BLOCK"},
	{Name: "Drop Database", Pattern: `\bDROP\s+DATABASE\b`, Action: "BLOCK"},
	{Name: "Bulk SELECT without WHERE", Pattern: `^\s*SELECT\s+\*\s+FROM\s+\S+\s*;?\s*$`, Action: "ALERT"},
}

const (
	generationConversationTTL   = 10 * time.Minute
	optimizationConversationTTL = 30 * time.Minute
)

func NewAIState() *aiState {
	return &aiState{
		generationConversations: make(map[string]generationConversation),
		optimizationSessions:    make(map[string]optimizationConversation),
	}
}

func (s Service) ensureAIState() *aiState {
	if s.AIState != nil {
		return s.AIState
	}
	return NewAIState()
}

func (s Service) HandleAnalyzeQuery(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req aiAnalyzeRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.Prompt = strings.TrimSpace(req.Prompt)
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.DBProtocol = normalizeKnownDBProtocol(req.DBProtocol)

	if req.Prompt == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "Prompt is required")
		return
	}
	if req.SessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "Session ID is required")
		return
	}
	if len(req.Prompt) > 2000 {
		app.ErrorJSON(w, http.StatusBadRequest, "Prompt must be 2000 characters or fewer")
		return
	}
	if strings.TrimSpace(claims.UserID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	schema, sessionProtocol := s.fetchSchemaForAI(r.Context(), claims.UserID, claims.TenantID, req.SessionID)
	dbProtocol := req.DBProtocol
	if dbProtocol == "" {
		dbProtocol = normalizeKnownDBProtocol(sessionProtocol)
	}
	if dbProtocol == "" {
		dbProtocol = "postgresql"
	}

	result, err := s.analyzeQueryIntent(r.Context(), analyzeQueryIntentParams{
		TenantID:   claims.TenantID,
		UserID:     claims.UserID,
		Prompt:     req.Prompt,
		Schema:     schema,
		DBProtocol: dbProtocol,
		IPAddress:  requestIP(r),
	})
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleConfirmGeneration(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req aiConfirmRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.ConversationID = strings.TrimSpace(req.ConversationID)
	if req.ConversationID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "conversationId is required")
		return
	}
	if len(req.ApprovedObjects) == 0 {
		app.ErrorJSON(w, http.StatusBadRequest, "approvedObjects must be a non-empty array of table names")
		return
	}
	if strings.TrimSpace(claims.UserID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.confirmAndGenerate(r.Context(), req.ConversationID, req.ApprovedObjects, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleOptimizeQuery(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req optimizeQueryRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.SQL = strings.TrimSpace(req.SQL)
	req.SessionID = strings.TrimSpace(req.SessionID)
	req.DBProtocol = normalizeKnownDBProtocol(req.DBProtocol)
	if req.SQL == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sql is required")
		return
	}
	if req.SessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sessionId is required")
		return
	}
	if req.DBProtocol == "" {
		_, sessionProtocol := s.fetchSchemaForAI(r.Context(), claims.UserID, claims.TenantID, req.SessionID)
		req.DBProtocol = normalizeKnownDBProtocol(sessionProtocol)
	}
	if req.DBProtocol == "" {
		app.ErrorJSON(w, http.StatusBadRequest, `Unsupported dbProtocol "". Must be one of: postgresql, mysql, mongodb, oracle, mssql, db2`)
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.optimizeQuery(r.Context(), optimizeQueryInput{
		SQL:           req.SQL,
		ExecutionPlan: req.ExecutionPlan,
		SessionID:     req.SessionID,
		DBProtocol:    req.DBProtocol,
		DBVersion:     strings.TrimSpace(req.DBVersion),
		SchemaContext: req.SchemaContext,
	}, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleContinueOptimization(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}

	var req continueOptimizationRequest
	if err := app.ReadJSON(r, &req); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	req.ConversationID = strings.TrimSpace(req.ConversationID)
	if req.ConversationID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "conversationId is required")
		return
	}
	if req.ApprovedData == nil {
		app.ErrorJSON(w, http.StatusBadRequest, "approvedData is required")
		return
	}
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant membership required")
		return
	}

	result, err := s.continueOptimization(r.Context(), req.ConversationID, req.ApprovedData, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

type analyzeQueryIntentParams struct {
	TenantID   string
	UserID     string
	Prompt     string
	Schema     []contracts.SchemaTable
	DBProtocol string
	IPAddress  string
}

func (s Service) analyzeQueryIntent(ctx context.Context, params analyzeQueryIntentParams) (aiAnalyzeResult, error) {
	tenantCfg, err := s.loadTenantRuntimeConfig(ctx, params.TenantID)
	if err != nil {
		return aiAnalyzeResult{}, err
	}

	envCfg := loadAIEnvConfig()
	if !envCfg.QueryGenerationEnabled && !tenantCfg.Enabled {
		return aiAnalyzeResult{}, &requestError{status: http.StatusForbidden, message: "AI query generation is not enabled"}
	}

	overrides := tenantLLMOverrides(tenantCfg, envCfg)
	if overrides != nil && strings.TrimSpace(overrides.Model) == "" {
		overrides.Model = strings.TrimSpace(envCfg.QueryGenerationModel)
	}
	if overrides == nil && strings.TrimSpace(envCfg.QueryGenerationModel) != "" {
		overrides = &llmOverrides{Model: strings.TrimSpace(envCfg.QueryGenerationModel)}
	}

	dailyLimit := tenantCfg.DailyRequestLimit
	if dailyLimit <= 0 {
		dailyLimit = envCfg.MaxRequestsPerDay
	}
	if err := s.incrementDailyCounter(ctx, params.TenantID, dailyLimit); err != nil {
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
	if evaluation, err := s.evaluateFirewall(ctx, tenantID, parsed.SQL, "", ""); err == nil && evaluation.Matched {
		switch evaluation.Action {
		case "BLOCK":
			message := "Firewall would block: " + evaluation.RuleName
			firewallWarning = &message
		default:
			message := "Firewall alert: " + evaluation.RuleName
			firewallWarning = &message
		}
	}

	provider := "none"
	modelID := ""
	envCfg := loadAIEnvConfig()
	if conv.Overrides != nil && strings.TrimSpace(string(conv.Overrides.Provider)) != "" {
		provider = string(conv.Overrides.Provider)
	}
	if provider == "none" && strings.TrimSpace(string(envCfg.Provider)) != "" {
		provider = string(envCfg.Provider)
	}
	if conv.Overrides != nil {
		modelID = strings.TrimSpace(conv.Overrides.Model)
	}
	if modelID == "" {
		modelID = strings.TrimSpace(envCfg.Model)
	}

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

func (s Service) optimizeQuery(ctx context.Context, input optimizeQueryInput, userID, tenantID, ipAddress string) (optimizeQueryResult, error) {
	envCfg := loadAIEnvConfig()
	tenantCfg, err := s.loadTenantRuntimeConfig(ctx, tenantID)
	if err != nil {
		return optimizeQueryResult{}, err
	}
	overrides := tenantLLMOverrides(tenantCfg, envCfg)
	if overrides == nil && strings.TrimSpace(string(envCfg.Provider)) == "" {
		return optimizeQueryResult{}, &requestError{
			status:  http.StatusServiceUnavailable,
			message: "AI query optimization is not available. An administrator must configure an AI/LLM provider in Settings.",
		}
	}

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

	provider, modelID := effectiveLLMProviderAndModel(overrides, envCfg)
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

	provider, modelID := effectiveLLMProviderAndModel(conversation.Overrides, loadAIEnvConfig())
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
		Temperature: envCfg.Temperature,
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

func (s Service) evaluateFirewall(ctx context.Context, tenantID, queryText, database, table string) (firewallEvaluation, error) {
	if s.DB == nil {
		return firewallEvaluation{}, errors.New("database is unavailable")
	}

	rows, err := s.DB.Query(ctx, `
SELECT name, pattern, action::text, scope, description, enabled, priority
FROM "DbFirewallRule"
WHERE "tenantId" = $1 AND enabled = true
ORDER BY priority DESC, "createdAt" DESC
`, tenantID)
	if err != nil {
		return firewallEvaluation{}, fmt.Errorf("list firewall rules: %w", err)
	}
	defer rows.Close()

	var rules []firewallRuleRecord
	for rows.Next() {
		var rule firewallRuleRecord
		if err := rows.Scan(&rule.Name, &rule.Pattern, &rule.Action, &rule.Scope, &rule.Description, &rule.Enabled, &rule.Priority); err != nil {
			return firewallEvaluation{}, fmt.Errorf("scan firewall rule: %w", err)
		}
		rules = append(rules, rule)
	}
	if err := rows.Err(); err != nil {
		return firewallEvaluation{}, fmt.Errorf("iterate firewall rules: %w", err)
	}

	for _, rule := range rules {
		if matchesFirewallRule(rule.Pattern, rule.Scope.String, queryText, database, table) {
			return firewallEvaluation{
				Allowed:   strings.ToUpper(strings.TrimSpace(rule.Action)) != "BLOCK",
				Action:    strings.ToUpper(strings.TrimSpace(rule.Action)),
				RuleName:  rule.Name,
				Matched:   true,
				RuleScope: rule.Scope.String,
			}, nil
		}
	}

	for _, builtin := range builtinFirewallPatterns {
		re, err := regexp.Compile("(?i)" + builtin.Pattern)
		if err != nil {
			continue
		}
		if re.MatchString(queryText) {
			return firewallEvaluation{
				Allowed:  builtin.Action != "BLOCK",
				Action:   builtin.Action,
				RuleName: "[Built-in] " + builtin.Name,
				Matched:  true,
			}, nil
		}
	}

	return firewallEvaluation{Allowed: true}, nil
}

func matchesFirewallRule(pattern, scope, queryText, database, table string) bool {
	if trimmed := strings.TrimSpace(scope); trimmed != "" {
		scopeLower := strings.ToLower(trimmed)
		dbMatch := strings.TrimSpace(database) != "" && strings.ToLower(strings.TrimSpace(database)) == scopeLower
		tableMatch := strings.TrimSpace(table) != "" && strings.ToLower(strings.TrimSpace(table)) == scopeLower
		if !dbMatch && !tableMatch {
			return false
		}
	}

	re, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		return false
	}
	return re.MatchString(queryText)
}

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
		if overrides.Temperature != 0 {
			temperature = overrides.Temperature
		}
		if overrides.Timeout > 0 {
			timeout = overrides.Timeout
		}
	}

	if options.MaxTokens > 0 {
		maxTokens = options.MaxTokens
	}
	if options.Temperature != 0 {
		temperature = options.Temperature
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
		return s.completeAnthropic(ctx, options.Messages, modelID, maxTokens, temperature, apiKey, timeout)
	case contracts.AIProviderOpenAI:
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, "https://api.openai.com", timeout, apiKey)
	case contracts.AIProviderOllama:
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, timeout, "")
	case contracts.AIProviderOpenAICompatible:
		return s.completeOpenAICompatible(ctx, options.Messages, modelID, maxTokens, temperature, baseURL, timeout, apiKey)
	default:
		return llmCompletionResult{}, &requestError{status: http.StatusServiceUnavailable, message: "AI provider is not supported."}
	}
}

func (s Service) completeAnthropic(ctx context.Context, messages []llmMessage, modelID string, maxTokens int, temperature float64, apiKey string, timeout time.Duration) (llmCompletionResult, error) {
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

	req, err := http.NewRequestWithContext(reqCtx, http.MethodPost, "https://api.anthropic.com/v1/messages", strings.NewReader(string(payload)))
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

	endpoint := strings.TrimRight(strings.TrimSpace(baseURL), "/") + "/v1/chat/completions"
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

func normalizePlanningIdentifier(value string) string {
	value = strings.TrimSpace(value)
	value = strings.Trim(value, "`\"'")
	value = strings.TrimPrefix(value, "[")
	value = strings.TrimSuffix(value, "]")
	return value
}

func splitQualifiedPlanningName(name string) (string, string) {
	name = normalizePlanningIdentifier(name)
	if !strings.Contains(name, ".") {
		return "", name
	}
	parts := strings.SplitN(name, ".", 2)
	return normalizePlanningIdentifier(parts[0]), normalizePlanningIdentifier(parts[1])
}

func resolvePlanningRequests(requests []objectRequest, schema []contracts.SchemaTable) []objectRequest {
	qualified := make(map[string]contracts.SchemaTable, len(schema))
	byName := make(map[string][]contracts.SchemaTable, len(schema))
	for _, table := range schema {
		normalizedSchema := normalizePlanningIdentifier(table.Schema)
		normalizedName := normalizePlanningIdentifier(table.Name)
		qualified[strings.ToLower(normalizedSchema+"."+normalizedName)] = table
		byName[strings.ToLower(normalizedName)] = append(byName[strings.ToLower(normalizedName)], table)
	}

	resolved := make([]objectRequest, 0, len(requests))
	seen := make(map[string]struct{}, len(requests))
	appendResolved := func(table contracts.SchemaTable, reason string) {
		key := strings.ToLower(normalizePlanningIdentifier(table.Schema) + "." + normalizePlanningIdentifier(table.Name))
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		resolved = append(resolved, objectRequest{
			Name:   strings.TrimSpace(table.Name),
			Schema: strings.TrimSpace(table.Schema),
			Reason: strings.TrimSpace(reason),
		})
	}

	for _, item := range requests {
		name := normalizePlanningIdentifier(item.Name)
		schemaName := normalizePlanningIdentifier(item.Schema)
		if name == "" {
			continue
		}
		if schemaName == "" && strings.Contains(name, ".") {
			schemaName, name = splitQualifiedPlanningName(name)
		}
		if schemaName != "" {
			if table, ok := qualified[strings.ToLower(schemaName+"."+name)]; ok {
				appendResolved(table, item.Reason)
				continue
			}
		}
		candidates := byName[strings.ToLower(name)]
		if len(candidates) == 1 {
			appendResolved(candidates[0], item.Reason)
			continue
		}
		if table, ok := fuzzyResolvePlanningTable(name, schemaName, schema); ok {
			appendResolved(table, item.Reason)
		}
	}

	return resolved
}

func fuzzyResolvePlanningTable(name, schemaName string, schema []contracts.SchemaTable) (contracts.SchemaTable, bool) {
	requestTokens := tokenizePlanningText(strings.TrimSpace(schemaName + " " + name))
	if len(requestTokens) == 0 {
		return contracts.SchemaTable{}, false
	}

	bestScore := 0
	bestIndex := -1
	ambiguous := false
	for idx, table := range schema {
		score := scorePlanningTableTokens(requestTokens, table)
		if schemaName != "" && strings.EqualFold(strings.TrimSpace(table.Schema), strings.TrimSpace(schemaName)) {
			score += 2
		}
		if score <= 0 {
			continue
		}
		if score > bestScore {
			bestScore = score
			bestIndex = idx
			ambiguous = false
			continue
		}
		if score == bestScore {
			ambiguous = true
		}
	}

	if bestIndex < 0 || ambiguous {
		return contracts.SchemaTable{}, false
	}
	return schema[bestIndex], true
}

func heuristicPlanningFallback(prompt string, schema []contracts.SchemaTable) []objectRequest {
	promptTokens := tokenizePlanningText(prompt)
	if len(promptTokens) == 0 {
		return nil
	}

	type candidate struct {
		table contracts.SchemaTable
		score int
	}

	candidates := make([]candidate, 0, len(schema))
	for _, table := range schema {
		score := scorePlanningTableTokens(promptTokens, table)
		if score <= 0 {
			continue
		}
		candidates = append(candidates, candidate{table: table, score: score})
	}
	if len(candidates) == 0 {
		return nil
	}

	sort.SliceStable(candidates, func(i, j int) bool {
		if candidates[i].score == candidates[j].score {
			left := strings.ToLower(candidates[i].table.Schema + "." + candidates[i].table.Name)
			right := strings.ToLower(candidates[j].table.Schema + "." + candidates[j].table.Name)
			return left < right
		}
		return candidates[i].score > candidates[j].score
	})

	limit := len(candidates)
	if limit > 5 {
		limit = 5
	}

	resolved := make([]objectRequest, 0, limit)
	for _, item := range candidates[:limit] {
		resolved = append(resolved, objectRequest{
			Name:   strings.TrimSpace(item.table.Name),
			Schema: strings.TrimSpace(item.table.Schema),
			Reason: "Matched prompt keywords heuristically after AI planning returned no direct table match.",
		})
	}
	return resolved
}

func tokenizePlanningText(value string) map[string]struct{} {
	parts := strings.FieldsFunc(strings.ToLower(value), func(r rune) bool {
		return (r < 'a' || r > 'z') && (r < '0' || r > '9')
	})
	if len(parts) == 0 {
		return nil
	}

	stopwords := map[string]struct{}{
		"a": {}, "an": {}, "and": {}, "all": {}, "by": {}, "for": {}, "from": {},
		"get": {}, "give": {}, "in": {}, "list": {}, "me": {}, "of": {}, "on": {},
		"show": {}, "the": {}, "to": {}, "top": {}, "with": {},
	}

	tokens := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if len(part) < 3 {
			continue
		}
		if _, skip := stopwords[part]; skip {
			continue
		}
		tokens[part] = struct{}{}
		if singular := strings.TrimSuffix(part, "s"); singular != part && len(singular) >= 3 {
			tokens[singular] = struct{}{}
		}
	}
	return tokens
}

func scorePlanningTableTokens(promptTokens map[string]struct{}, table contracts.SchemaTable) int {
	if len(promptTokens) == 0 {
		return 0
	}

	tableTokens := tokenizePlanningText(table.Schema + " " + table.Name)
	score := 0
	for token := range tableTokens {
		if isPlanningNoiseToken(token) {
			continue
		}
		if _, ok := promptTokens[token]; ok {
			score += 3
		}
	}
	for _, column := range table.Columns {
		columnTokens := tokenizePlanningText(column.Name)
		for token := range columnTokens {
			if isPlanningNoiseToken(token) {
				continue
			}
			if _, ok := promptTokens[token]; ok {
				score++
			}
		}
	}
	return score
}

func isPlanningNoiseToken(token string) bool {
	switch token {
	case "all", "arsenale", "data", "dbo", "demo", "field", "public", "record", "table", "value":
		return true
	default:
		return false
	}
}

func buildPlanningSystemPrompt(dbProtocol string) string {
	objectLabel := "tables"
	if isMongoDBProtocol(dbProtocol) {
		objectLabel = "collections"
	}

	return fmt.Sprintf(`You are a database query planning assistant. Given a user's request and a list of available database %s, determine which %s are needed to write the query.

Return ONLY valid JSON with no markdown fences:
{"tables": [{"name": "table_name", "schema": "schema_name", "reason": "brief reason this table is needed"}]}

Rules:
- Only include %s that are genuinely needed to answer the user's request.
- Do not invent %s that are not in the provided list.
- Include relationship or lookup %s if the query requires them.
- Keep reasons concise (one sentence).`, objectLabel, objectLabel, objectLabel, objectLabel, objectLabel)
}

func formatTableList(tables []contracts.SchemaTable, dbProtocol string) string {
	objectLabel := "tables"
	if isMongoDBProtocol(dbProtocol) {
		objectLabel = "collections"
	}
	if len(tables) == 0 {
		return "No " + objectLabel + " available."
	}
	lines := []string{"Available " + objectLabel + ":"}
	limit := len(tables)
	if limit > 100 {
		limit = 100
	}
	for _, table := range tables[:limit] {
		displayName := table.Name
		if trimmed := strings.TrimSpace(table.Schema); trimmed != "" && trimmed != "public" {
			if isMongoDBProtocol(dbProtocol) {
				displayName = table.Name + " (database " + trimmed + ")"
			} else {
				displayName = trimmed + "." + table.Name
			}
		}
		columns := make([]string, 0, len(table.Columns))
		for _, column := range table.Columns {
			columns = append(columns, column.Name)
		}
		lines = append(lines, "- "+displayName+" ("+strings.Join(columns, ", ")+")")
	}
	return strings.Join(lines, "\n")
}

func parsePlanningResponse(raw string) []objectRequest {
	extracted, err := extractJSON(raw)
	if err != nil {
		return nil
	}
	root, ok := extracted.(map[string]any)
	if !ok {
		return nil
	}
	items, ok := root["tables"].([]any)
	if !ok {
		return nil
	}
	result := make([]objectRequest, 0, len(items))
	for _, item := range items {
		record, ok := item.(map[string]any)
		if !ok {
			continue
		}
		name, _ := record["name"].(string)
		if strings.TrimSpace(name) == "" {
			continue
		}
		schema, _ := record["schema"].(string)
		reason, _ := record["reason"].(string)
		result = append(result, objectRequest{
			Name:   normalizePlanningIdentifier(name),
			Schema: normalizePlanningIdentifier(schema),
			Reason: strings.TrimSpace(reason),
		})
	}
	return result
}

func buildGenerationSystemPrompt(dbProtocol string) string {
	if isMongoDBProtocol(dbProtocol) {
		return `You are a MongoDB query assistant. You generate Arsenale MongoDB JSON query specs from natural-language requests.

CRITICAL CONSTRAINT:
You may ONLY reference collections that appear in the schema below. The user has explicitly approved only these collections. You MUST NOT reference any other collection.

Return ONLY valid JSON with two fields:
{
  "query": {
    "collection": "collection_name",
    "operation": "find|aggregate|count|distinct|runCommand",
    "...": "other supported fields"
  },
  "explanation": "brief explanation"
}

Rules:
1. Only generate read-only MongoDB operations: find, aggregate, count, distinct, or runCommand.
2. ALWAYS include an explicit "operation" field.
3. Set "collection" to the bare collection name only. Do NOT prefix it with database or schema names like "arsenale_demo.demo_customers".
4. Only use a separate "database" field when you intentionally need a different database; otherwise omit it.
5. Use ONLY collection and field names from the provided schema.
6. Never return shell syntax, JavaScript, db.collection.find(...), or SQL.
7. For simple retrievals, prefer "find". Use "aggregate" only when grouping, joining-like lookup, or computed totals are needed.
8. For "find", include a reasonable "limit" when the user did not specify one.
9. For "distinct", include both "collection" and "field".
10. For "aggregate", include both "collection" and "pipeline".
11. For "runCommand", include a "command" object.
12. If the approved collections are insufficient, write the best read-only query you can using ONLY the approved collections and explain the limitation.`
	}

	dialect := strings.ToUpper(strings.TrimSpace(dbProtocol))
	if dialect == "" {
		dialect = "POSTGRESQL"
	}
	return fmt.Sprintf(`You are a SQL query assistant. You generate SQL queries from natural language descriptions.

CRITICAL CONSTRAINT:
You may ONLY reference tables that appear in the schema below. The user has explicitly approved only these tables. You MUST NOT reference, join, subquery, or otherwise use ANY table not listed in the schema. If the approved tables are insufficient to fully answer the request, write the best query you can using ONLY the approved tables and explain the limitation.

RULES:
1. ONLY generate SELECT queries. NEVER generate INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE, or any DML/DDL statements.
2. Use the correct SQL dialect for %s.
3. ONLY use table and column names from the provided schema — do not reference any other tables.
4. If the request is ambiguous, make reasonable assumptions and explain them.
5. When the user does not specify a limit, add a reasonable limit on the number of returned rows. Use the appropriate limiting syntax for the %s dialect (for example, LIMIT for PostgreSQL/MySQL, TOP for MSSQL, FETCH FIRST for DB2/Oracle).
6. Use table aliases for readability.
7. Return your response as a JSON object with two fields:
   - "sql": the generated SELECT query (using ONLY approved tables)
   - "explanation": a brief explanation of what the query does and any assumptions made

Example response:
{"sql": "SELECT o.id, o.total FROM orders o WHERE o.total > 1000", "explanation": "Retrieves orders where the total is greater than 1000."}`, dialect, dialect)
}

func formatSchemaContext(tables []contracts.SchemaTable, dbProtocol string) string {
	if len(tables) == 0 {
		return "No schema information available."
	}
	lines := []string{"Database type: " + dbProtocol, "", "Schema:"}
	objectLabel := "TABLE"
	if isMongoDBProtocol(dbProtocol) {
		objectLabel = "COLLECTION"
	}
	limit := len(tables)
	if limit > 50 {
		limit = 50
	}
	for _, table := range tables[:limit] {
		displayName := table.Name
		if trimmed := strings.TrimSpace(table.Schema); trimmed != "" && trimmed != "public" {
			if isMongoDBProtocol(dbProtocol) {
				displayName = table.Name + " (database " + trimmed + ")"
			} else {
				displayName = trimmed + "." + table.Name
			}
		}
		lines = append(lines, "", objectLabel+" "+displayName+":")
		for _, column := range table.Columns {
			nullable := " NOT NULL"
			if column.Nullable {
				nullable = " NULL"
			}
			pk := ""
			if column.IsPrimaryKey {
				pk = " PK"
			}
			lines = append(lines, "  "+column.Name+" "+column.DataType+nullable+pk)
		}
	}
	return strings.Join(lines, "\n")
}

type generationResponse struct {
	SQL         string
	Explanation string
}

func parseGenerationResponse(raw string) generationResponse {
	extracted, err := extractJSON(raw)
	if err == nil {
		if record, ok := extracted.(map[string]any); ok {
			if queryText := extractQueryTextValue(record["sql"]); queryText != "" {
				explanation, _ := record["explanation"].(string)
				return generationResponse{
					SQL:         strings.TrimSpace(queryText),
					Explanation: strings.TrimSpace(explanation),
				}
			}
			if queryText := extractQueryTextValue(record["query"]); queryText != "" {
				explanation, _ := record["explanation"].(string)
				return generationResponse{
					SQL:         strings.TrimSpace(queryText),
					Explanation: strings.TrimSpace(explanation),
				}
			}
			if queryText := extractQueryTextValue(record["query_spec"]); queryText != "" {
				explanation, _ := record["explanation"].(string)
				return generationResponse{
					SQL:         strings.TrimSpace(queryText),
					Explanation: strings.TrimSpace(explanation),
				}
			}
		}
	}

	blockPatterns := []*regexp.Regexp{
		regexp.MustCompile("(?is)```sql\\s*(.*?)```"),
		regexp.MustCompile("(?is)```\\s*(.*?)```"),
	}
	for _, pattern := range blockPatterns {
		match := pattern.FindStringSubmatch(raw)
		if len(match) == 2 {
			return generationResponse{SQL: strings.TrimSpace(match[1])}
		}
	}
	return generationResponse{SQL: strings.TrimSpace(raw)}
}

func extractQueryTextValue(value any) string {
	switch typed := value.(type) {
	case string:
		return strings.TrimSpace(typed)
	case map[string]any:
		payload, err := json.MarshalIndent(typed, "", "  ")
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(payload))
	case []any:
		payload, err := json.MarshalIndent(typed, "", "  ")
		if err != nil {
			return ""
		}
		return strings.TrimSpace(string(payload))
	default:
		return ""
	}
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

func normalizeQueryForProtocol(dbProtocol, queryText string, readOnly bool) (string, error) {
	queryText = strings.TrimSpace(queryText)
	if queryText == "" {
		return "", &requestError{status: http.StatusBadRequest, message: "The AI did not return a query."}
	}

	if isMongoDBProtocol(dbProtocol) {
		var (
			normalized string
			err        error
		)
		if readOnly {
			normalized, _, _, err = queryrunner.NormalizeMongoReadOnlyQueryText(queryText)
		} else {
			normalized, _, _, err = queryrunner.NormalizeMongoQueryText(queryText)
		}
		if err != nil {
			return "", &requestError{status: http.StatusBadRequest, message: "The AI generated an invalid MongoDB query spec: " + err.Error()}
		}
		return normalized, nil
	}

	if err := validateGeneratedSQL(queryText); err != nil {
		return "", err
	}
	return queryText, nil
}

func stabilizeMongoOptimizedQuery(originalQuery, optimizedQuery string) (string, bool, error) {
	originalNormalized, err := normalizeQueryForProtocol("mongodb", originalQuery, true)
	if err != nil {
		return optimizedQuery, false, err
	}
	optimizedNormalized, err := normalizeQueryForProtocol("mongodb", optimizedQuery, true)
	if err != nil {
		return optimizedQuery, false, err
	}

	var originalSpec map[string]any
	if err := json.Unmarshal([]byte(originalNormalized), &originalSpec); err != nil {
		return optimizedNormalized, false, err
	}
	var optimizedSpec map[string]any
	if err := json.Unmarshal([]byte(optimizedNormalized), &optimizedSpec); err != nil {
		return optimizedNormalized, false, err
	}

	originalOp := normalizeMongoOptimizationOperation(originalSpec["operation"])
	optimizedOp := normalizeMongoOptimizationOperation(optimizedSpec["operation"])
	if originalOp == "" {
		return optimizedNormalized, false, nil
	}

	changed := false
	if optimizedOp == "" {
		optimizedSpec["operation"] = originalSpec["operation"]
		optimizedOp = originalOp
		changed = true
	}
	if optimizedOp != originalOp {
		return originalNormalized, true, nil
	}

	changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "database") || changed
	changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "collection") || changed

	switch originalOp {
	case "find":
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "filter") || changed
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "projection") || changed
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "sort") || changed
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "limit") || changed
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "skip") || changed
	case "count":
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "filter") || changed
	case "distinct":
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "filter") || changed
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "field") || changed
	case "aggregate":
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "pipeline") || changed
	case "runcommand":
		changed = copyMongoValueIfMissing(optimizedSpec, originalSpec, "command") || changed
	}

	payload, err := json.MarshalIndent(optimizedSpec, "", "  ")
	if err != nil {
		return optimizedNormalized, changed, err
	}
	stabilized, err := normalizeQueryForProtocol("mongodb", string(payload), true)
	if err != nil {
		return optimizedNormalized, changed, err
	}
	return stabilized, changed, nil
}

func normalizeMongoOptimizationOperation(value any) string {
	text, _ := value.(string)
	text = strings.ToLower(strings.TrimSpace(text))
	text = strings.ReplaceAll(text, "_", "")
	text = strings.ReplaceAll(text, "-", "")
	switch text {
	case "countdocument", "countdocuments", "estimateddocumentcount":
		return "count"
	case "runcmd":
		return "runcommand"
	default:
		return text
	}
}

func copyMongoValueIfMissing(dst, src map[string]any, key string) bool {
	if !mongoValueMissing(dst[key]) {
		return false
	}
	value, ok := src[key]
	if !ok || mongoValueMissing(value) {
		return false
	}
	dst[key] = value
	return true
}

func mongoValueMissing(value any) bool {
	switch typed := value.(type) {
	case nil:
		return true
	case string:
		return strings.TrimSpace(typed) == ""
	case []any:
		return len(typed) == 0
	case map[string]any:
		return len(typed) == 0
	case float64:
		return typed == 0
	case int:
		return typed == 0
	case int32:
		return typed == 0
	case int64:
		return typed == 0
	default:
		return false
	}
}

func appendMongoSemanticsNote(explanation string) string {
	note := "Missing MongoDB filter/sort/limit fields were preserved from the original query to keep the same result set semantics."
	explanation = strings.TrimSpace(explanation)
	if explanation == "" {
		return note
	}
	if strings.Contains(explanation, note) {
		return explanation
	}
	return explanation + " " + note
}

func findUnapprovedTableReference(sqlText string, approvedTables, allTables []contracts.SchemaTable) string {
	approved := make(map[string]struct{}, len(approvedTables)*2)
	for _, table := range approvedTables {
		approved[strings.ToLower(table.Name)] = struct{}{}
		approved[strings.ToLower(table.Schema+"."+table.Name)] = struct{}{}
	}

	lowered := strings.ToLower(sqlText)
	for _, table := range allTables {
		unqualified := strings.ToLower(table.Name)
		qualified := strings.ToLower(table.Schema + "." + table.Name)
		if _, ok := approved[unqualified]; ok {
			continue
		}
		if _, ok := approved[qualified]; ok {
			continue
		}
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(unqualified) + `\b`).MatchString(lowered) {
			if table.Schema != "" && table.Schema != "public" {
				return table.Schema + "." + table.Name
			}
			return table.Name
		}
		if regexp.MustCompile(`\b` + regexp.QuoteMeta(qualified) + `\b`).MatchString(lowered) {
			return table.Schema + "." + table.Name
		}
	}
	return ""
}

func collectDeniedTables(filteredSchema, fullSchema []contracts.SchemaTable) []string {
	allowed := make(map[string]struct{}, len(filteredSchema))
	for _, table := range filteredSchema {
		allowed[strings.ToLower(table.Schema+"."+table.Name)] = struct{}{}
	}
	var denied []string
	for _, table := range fullSchema {
		key := strings.ToLower(table.Schema + "." + table.Name)
		if _, ok := allowed[key]; ok {
			continue
		}
		if table.Schema != "" && table.Schema != "public" {
			denied = append(denied, table.Schema+"."+table.Name)
		} else {
			denied = append(denied, table.Name)
		}
	}
	return denied
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

func pruneGenerationLocked(state *aiState, now time.Time) {
	for id, conversation := range state.generationConversations {
		if now.Sub(conversation.CreatedAt) > generationConversationTTL {
			delete(state.generationConversations, id)
		}
	}
}

func pruneOptimizationLocked(state *aiState, now time.Time) {
	for id, conversation := range state.optimizationSessions {
		if now.Sub(conversation.CreatedAt) > optimizationConversationTTL {
			delete(state.optimizationSessions, id)
		}
	}
}

func cloneSchemaTables(tables []contracts.SchemaTable) []contracts.SchemaTable {
	cloned := make([]contracts.SchemaTable, 0, len(tables))
	for _, table := range tables {
		item := table
		if len(table.Columns) > 0 {
			item.Columns = append([]contracts.SchemaColumn(nil), table.Columns...)
		}
		cloned = append(cloned, item)
	}
	return cloned
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

func requestIP(r *http.Request) string {
	candidates := []string{
		strings.TrimSpace(r.Header.Get("X-Real-IP")),
		firstForwardedValue(r.Header.Get("X-Forwarded-For")),
		strings.TrimSpace(r.RemoteAddr),
	}
	for _, candidate := range candidates {
		candidate = stripPort(candidate)
		candidate = strings.TrimPrefix(candidate, "::ffff:")
		if candidate != "" {
			return candidate
		}
	}
	return ""
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}

func firstForwardedValue(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}
