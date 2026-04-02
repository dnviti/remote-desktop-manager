package modelgatewayapi

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/modelgateway"
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

	var overrides *llmOverrides
	if tenantCfg.Provider != contracts.AIProviderNone && tenantCfg.APIKey != "" {
		model := strings.TrimSpace(tenantCfg.ModelID)
		if model == "" {
			model = strings.TrimSpace(envCfg.QueryGenerationModel)
		}
		overrides = &llmOverrides{
			Provider:    tenantCfg.Provider,
			APIKey:      tenantCfg.APIKey,
			Model:       model,
			BaseURL:     strings.TrimSpace(tenantCfg.BaseURL),
			MaxTokens:   tenantCfg.MaxTokensPerRequest,
			Temperature: envCfg.Temperature,
			Timeout:     envCfg.Timeout,
		}
	} else if strings.TrimSpace(envCfg.QueryGenerationModel) != "" {
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
			{Role: "system", Content: buildPlanningSystemPrompt()},
			{Role: "user", Content: formatTableList(params.Schema) + "\n\nUser request: " + params.Prompt},
		},
	}, overrides)
	if err != nil {
		return aiAnalyzeResult{}, err
	}

	requests := parsePlanningResponse(raw.Content)
	schemaLookup := make(map[string]struct{}, len(params.Schema))
	for _, table := range params.Schema {
		schemaLookup[strings.ToLower(table.Schema+"."+table.Name)] = struct{}{}
	}

	filtered := make([]objectRequest, 0, len(requests))
	for _, item := range requests {
		if _, ok := schemaLookup[strings.ToLower(item.Schema+"."+item.Name)]; ok {
			filtered = append(filtered, item)
		}
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
	if err := validateGeneratedSQL(parsed.SQL); err != nil {
		return aiGenerateResult{}, err
	}

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
		if err := validateGeneratedSQL(parsed.SQL); err != nil {
			return aiGenerateResult{}, err
		}
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
	if strings.TrimSpace(string(envCfg.Provider)) == "" {
		return optimizeQueryResult{}, &requestError{
			status:  http.StatusServiceUnavailable,
			message: "AI query optimization is not available. An administrator must configure an AI/LLM provider in Settings.",
		}
	}

	conversationID := uuid.NewString()
	messages := []llmMessage{
		{Role: "system", Content: optimizationSystemPrompt},
		{Role: "user", Content: buildFirstTurnMessage(input)},
	}

	raw, err := s.completeLLM(ctx, llmCompletionOptions{Messages: messages}, nil)
	var parsed firstTurnResponse
	if err != nil {
		parsed = buildHeuristicDataRequests(input.SQL)
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
		CreatedAt:    now,
	}
	state.mu.Unlock()

	_ = s.insertAuditLog(ctx, userID, "DB_QUERY_AI_OPTIMIZED", "DatabaseQuery", input.SessionID, map[string]any{
		"conversationId":   conversationID,
		"phase":            "initial",
		"provider":         string(envCfg.Provider),
		"dataRequestCount": len(parsed.DataRequests),
		"dataRequestTypes": collectDataRequestTypes(parsed.DataRequests),
	}, ipAddress)

	if !parsed.NeedsData {
		state.mu.Lock()
		delete(state.optimizationSessions, conversationID)
		state.mu.Unlock()
		optimizedSQL := parsed.OptimizedSQL
		if optimizedSQL == "" {
			optimizedSQL = input.SQL
		}
		explanation := parsed.Explanation
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

	raw, err := s.completeLLM(ctx, llmCompletionOptions{Messages: messages}, nil)
	parsed := secondTurnResponse{
		OptimizedSQL: conversation.Input.SQL,
		Explanation:  "AI analysis could not be completed. The original query is returned unchanged.",
		Changes:      []string{},
	}
	if err == nil {
		parsed = parseSecondTurnResponse(raw.Content, conversation.Input.SQL)
	}

	_ = s.insertAuditLog(ctx, userID, "DB_QUERY_AI_OPTIMIZED", "DatabaseQuery", conversation.Input.SessionID, map[string]any{
		"conversationId":   conversationID,
		"phase":            "continue",
		"round":            conversation.Rounds,
		"provider":         string(loadAIEnvConfig().Provider),
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
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: fmt.Sprintf("AI service returned an error (status %d).", resp.StatusCode)}
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
		return llmCompletionResult{}, &requestError{status: http.StatusBadGateway, message: fmt.Sprintf("AI service returned an error (status %d).", resp.StatusCode)}
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

func normalizeKnownDBProtocol(protocol string) string {
	protocol = strings.ToLower(strings.TrimSpace(protocol))
	if _, ok := knownDBProtocols[protocol]; ok {
		return protocol
	}
	return ""
}

func buildPlanningSystemPrompt() string {
	return `You are a SQL query planning assistant. Given a user's request and a list of available database tables, determine which tables are needed to write the query.

Return ONLY valid JSON with no markdown fences:
{"tables": [{"name": "table_name", "schema": "schema_name", "reason": "brief reason this table is needed"}]}

Rules:
- Only include tables that are genuinely needed to answer the user's request.
- Do not invent tables that are not in the provided list.
- Include join tables if a relationship requires them.
- Keep reasons concise (one sentence).`
}

func formatTableList(tables []contracts.SchemaTable) string {
	if len(tables) == 0 {
		return "No tables available."
	}
	lines := []string{"Available tables:"}
	limit := len(tables)
	if limit > 100 {
		limit = 100
	}
	for _, table := range tables[:limit] {
		qualified := table.Name
		if trimmed := strings.TrimSpace(table.Schema); trimmed != "" && trimmed != "public" {
			qualified = trimmed + "." + table.Name
		}
		columns := make([]string, 0, len(table.Columns))
		for _, column := range table.Columns {
			columns = append(columns, column.Name)
		}
		lines = append(lines, "- "+qualified+" ("+strings.Join(columns, ", ")+")")
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
		if strings.TrimSpace(schema) == "" {
			schema = "public"
		}
		result = append(result, objectRequest{
			Name:   strings.TrimSpace(name),
			Schema: strings.TrimSpace(schema),
			Reason: strings.TrimSpace(reason),
		})
	}
	return result
}

func buildGenerationSystemPrompt(dbProtocol string) string {
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
	limit := len(tables)
	if limit > 50 {
		limit = 50
	}
	for _, table := range tables[:limit] {
		qualified := table.Name
		if trimmed := strings.TrimSpace(table.Schema); trimmed != "" && trimmed != "public" {
			qualified = trimmed + "." + table.Name
		}
		lines = append(lines, "", "TABLE "+qualified+":")
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
			if sqlText, ok := record["sql"].(string); ok && strings.TrimSpace(sqlText) != "" {
				explanation, _ := record["explanation"].(string)
				return generationResponse{
					SQL:         strings.TrimSpace(sqlText),
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

const optimizationSystemPrompt = `You are an expert SQL performance analyst and query optimizer.
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

func buildFirstTurnMessage(input optimizeQueryInput) string {
	parts := []string{"Database: " + input.DBProtocol}
	if strings.TrimSpace(input.DBVersion) != "" {
		parts[0] += " " + strings.TrimSpace(input.DBVersion)
	}
	parts = append(parts, "", "SQL Query:", input.SQL)
	if input.ExecutionPlan != nil {
		plan := stringifyLLMContext(input.ExecutionPlan)
		if len(plan) > 50000 {
			plan = plan[:50000] + "\n[truncated]"
		}
		parts = append(parts, "", "Execution Plan:", plan)
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
	if value, ok := root["optimized_sql"].(string); ok {
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
	if value, ok := root["optimized_sql"].(string); ok && strings.TrimSpace(value) != "" {
		result.OptimizedSQL = strings.TrimSpace(value)
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

func buildHeuristicDataRequests(sqlText string) firstTurnResponse {
	tables := extractTablesFromSQL(sqlText)
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
