package modelgatewayapi

import (
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/dbsessions"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
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
	AIContext  dbsessions.OwnedAIContext
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
	Temperature *float64
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
	Temperature *float64
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

type analyzeQueryIntentParams struct {
	TenantID   string
	UserID     string
	Prompt     string
	Schema     []contracts.SchemaTable
	DBProtocol string
	AIContext  dbsessions.OwnedAIContext
	IPAddress  string
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
