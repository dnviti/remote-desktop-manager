package cmd

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/spf13/cobra"
)

type aiDatabaseSession struct {
	SessionID    string `json:"sessionId"`
	Protocol     string `json:"protocol"`
	DatabaseName string `json:"databaseName,omitempty"`
	Username     string `json:"username,omitempty"`
}

type aiObjectRequest struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Reason string `json:"reason"`
}

type aiGenerateAnalyzeResponse struct {
	Status         string            `json:"status"`
	ConversationID string            `json:"conversationId"`
	ObjectRequests []aiObjectRequest `json:"objectRequests"`
}

type aiGenerateConfirmResponse struct {
	Status          string  `json:"status"`
	SQL             string  `json:"sql"`
	Explanation     string  `json:"explanation"`
	FirewallWarning *string `json:"firewallWarning,omitempty"`
}

type aiDataRequest struct {
	Type   string `json:"type"`
	Target string `json:"target"`
	Reason string `json:"reason"`
}

type aiOptimizeResponse struct {
	Status         string          `json:"status"`
	ConversationID string          `json:"conversationId"`
	DataRequests   []aiDataRequest `json:"dataRequests,omitempty"`
	OptimizedSQL   string          `json:"optimizedSql,omitempty"`
	Explanation    string          `json:"explanation,omitempty"`
	Changes        []string        `json:"changes,omitempty"`
}

type aiExecutionPlanResponse struct {
	Supported bool `json:"supported"`
	Plan      any  `json:"plan"`
}

type aiIntrospectionResponse struct {
	Supported bool `json:"supported"`
	Data      any  `json:"data"`
}

var (
	aiSQLGeneratePrompt     string
	aiSQLGeneratePromptFile string
	aiSQLGenerateReviewOnly bool
	aiSQLOptimizeSQL        string
	aiSQLOptimizeSQLFile    string
	aiSQLOptimizeReviewOnly bool
)

var aiSQLCmd = &cobra.Command{
	Use:   "sql",
	Short: "Use AI SQL features headlessly through platform settings",
	Long: `Run AI SQL generation and optimization from the CLI.

These commands use the tenant's configured AI provider and model from platform
Settings. No provider or API key flags are required on the CLI side.`,
}

var aiSQLGenerateCmd = &cobra.Command{
	Use:   "generate <connection-name-or-id>",
	Short: "Generate SQL from natural language through the configured platform AI provider",
	Args:  cobra.ExactArgs(1),
	Run:   runAISQLGenerate,
}

var aiSQLOptimizeCmd = &cobra.Command{
	Use:   "optimize <connection-name-or-id>",
	Short: "Optimize SQL through the configured platform AI provider",
	Args:  cobra.ExactArgs(1),
	Run:   runAISQLOptimize,
}

var aiGenerateReviewColumns = []Column{
	{Header: "STATUS", Field: "status"},
	{Header: "CONVERSATION", Field: "conversationId"},
}

var aiGenerateRequestColumns = []Column{
	{Header: "SCHEMA", Field: "schema"},
	{Header: "TABLE", Field: "name"},
	{Header: "REASON", Field: "reason"},
}

var aiGenerateResultColumns = []Column{
	{Header: "STATUS", Field: "status"},
	{Header: "SQL", Field: "sql"},
	{Header: "EXPLANATION", Field: "explanation"},
	{Header: "FIREWALL", Field: "firewallWarning"},
}

var aiOptimizeReviewColumns = []Column{
	{Header: "STATUS", Field: "status"},
	{Header: "CONVERSATION", Field: "conversationId"},
}

var aiOptimizeRequestColumns = []Column{
	{Header: "TYPE", Field: "type"},
	{Header: "TARGET", Field: "target"},
	{Header: "REASON", Field: "reason"},
}

var aiOptimizeResultColumns = []Column{
	{Header: "STATUS", Field: "status"},
	{Header: "OPTIMIZED_SQL", Field: "optimizedSql"},
	{Header: "EXPLANATION", Field: "explanation"},
	{Header: "CHANGES", Field: "changes"},
}

func init() {
	aiCmd.AddCommand(aiSQLCmd)
	aiSQLCmd.AddCommand(aiSQLGenerateCmd)
	aiSQLCmd.AddCommand(aiSQLOptimizeCmd)

	aiSQLGenerateCmd.Flags().StringVar(&aiSQLGeneratePrompt, "prompt", "", "Natural-language prompt to convert into SQL")
	aiSQLGenerateCmd.Flags().StringVar(&aiSQLGeneratePromptFile, "prompt-file", "", "Read the natural-language prompt from a file or - for stdin")
	aiSQLGenerateCmd.Flags().BoolVar(&aiSQLGenerateReviewOnly, "review-only", false, "Only show the tables the AI wants to use; do not auto-approve")

	aiSQLOptimizeCmd.Flags().StringVar(&aiSQLOptimizeSQL, "sql", "", "SQL query to optimize")
	aiSQLOptimizeCmd.Flags().StringVar(&aiSQLOptimizeSQLFile, "sql-file", "", "Read the SQL query from a file or - for stdin")
	aiSQLOptimizeCmd.Flags().BoolVar(&aiSQLOptimizeReviewOnly, "review-only", false, "Only show the metadata requests the AI wants; do not auto-approve")
}

func runAISQLGenerate(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	prompt, err := readAITextInput(aiSQLGeneratePrompt, aiSQLGeneratePromptFile, "prompt")
	if err != nil {
		fatal("%v", err)
	}

	session := createAIDatabaseSession(args[0], cfg)
	defer endAIDatabaseSession(session.SessionID, cfg)

	analyzeBody, status, err := apiPost("/api/ai/generate-query", map[string]any{
		"sessionId":  session.SessionID,
		"prompt":     prompt,
		"dbProtocol": session.Protocol,
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, analyzeBody)

	var analyzeResp aiGenerateAnalyzeResponse
	mustUnmarshalAPIJSON(analyzeBody, &analyzeResp)

	if aiSQLGenerateReviewOnly || analyzeResp.Status != "pending_approval" {
		printAIReviewOutput(analyzeBody, aiGenerateReviewColumns, analyzeResp.ObjectRequests, aiGenerateRequestColumns, "Requested tables")
		return
	}

	confirmBody, status, err := apiPost("/api/ai/generate-query/confirm", map[string]any{
		"conversationId":  analyzeResp.ConversationID,
		"approvedObjects": approvedObjectNames(analyzeResp.ObjectRequests),
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, confirmBody)
	if err := printer().PrintSingle(confirmBody, aiGenerateResultColumns); err != nil {
		fatal("print AI SQL generation result: %v", err)
	}
}

func runAISQLOptimize(cmd *cobra.Command, args []string) {
	cfg := getCfg()
	if err := ensureAuthenticated(cfg); err != nil {
		fatal("%v", err)
	}

	sqlText, err := readAITextInput(aiSQLOptimizeSQL, aiSQLOptimizeSQLFile, "sql")
	if err != nil {
		fatal("%v", err)
	}

	session := createAIDatabaseSession(args[0], cfg)
	defer endAIDatabaseSession(session.SessionID, cfg)

	optimizePayload := map[string]any{
		"sessionId":     session.SessionID,
		"sql":           sqlText,
		"dbProtocol":    session.Protocol,
		"executionPlan": fetchAIExecutionPlan(session.SessionID, sqlText, cfg),
	}
	optimizeBody, status, err := apiPost("/api/ai/optimize-query", optimizePayload, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, optimizeBody)

	var optimizeResp aiOptimizeResponse
	mustUnmarshalAPIJSON(optimizeBody, &optimizeResp)

	if aiSQLOptimizeReviewOnly || optimizeResp.Status != "needs_data" {
		printAIReviewOutput(optimizeBody, aiOptimizeReviewColumns, optimizeResp.DataRequests, aiOptimizeRequestColumns, "Requested metadata")
		return
	}

	approvedData := buildApprovedOptimizationData(optimizeResp.DataRequests, func(req aiDataRequest) (any, error) {
		introspectBody, introspectStatus, introspectErr := apiPost(
			fmt.Sprintf("/api/sessions/database/%s/introspect", url.PathEscape(session.SessionID)),
			map[string]any{"type": req.Type, "target": req.Target},
			cfg,
		)
		if introspectErr != nil {
			return nil, introspectErr
		}
		checkAPIError(introspectStatus, introspectBody)

		var introspectResp aiIntrospectionResponse
		mustUnmarshalAPIJSON(introspectBody, &introspectResp)
		return introspectResp.Data, nil
	})

	continueBody, status, err := apiPost("/api/ai/optimize-query/continue", map[string]any{
		"conversationId": optimizeResp.ConversationID,
		"approvedData":   approvedData,
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, continueBody)
	if err := printer().PrintSingle(continueBody, aiOptimizeResultColumns); err != nil {
		fatal("print AI SQL optimization result: %v", err)
	}
}

func readAITextInput(value, filePath, label string) (string, error) {
	switch {
	case strings.TrimSpace(value) != "" && strings.TrimSpace(filePath) != "":
		return "", fmt.Errorf("provide either --%s or --%s-file, not both", label, label)
	case strings.TrimSpace(value) != "":
		return strings.TrimSpace(value), nil
	case strings.TrimSpace(filePath) != "":
		return readTextFromFileOrStdin(filePath)
	default:
		return "", fmt.Errorf("--%s or --%s-file is required", label, label)
	}
}

func resolveConnectionForAI(nameOrID string, cfg *CLIConfig) *Connection {
	body, status, err := apiGet("/api/connections/"+url.PathEscape(nameOrID), cfg)
	if err == nil && status == 200 {
		var conn Connection
		mustUnmarshalAPIJSON(body, &conn)
		if !strings.EqualFold(conn.Type, "DATABASE") {
			fatal("connection %q is type %q, not DATABASE", nameOrID, conn.Type)
		}
		return &conn
	}

	conn, err := findConnectionByName(nameOrID, cfg)
	if err != nil {
		fatal("%v", err)
	}
	if !strings.EqualFold(conn.Type, "DATABASE") {
		fatal("connection %q is type %q, not DATABASE", nameOrID, conn.Type)
	}
	return conn
}

func createAIDatabaseSession(connectionNameOrID string, cfg *CLIConfig) aiDatabaseSession {
	conn := resolveConnectionForAI(connectionNameOrID, cfg)

	body, status, err := apiPost("/api/sessions/database", map[string]any{
		"connectionId": conn.ID,
	}, cfg)
	if err != nil {
		fatal("%v", err)
	}
	checkAPIError(status, body)

	var session aiDatabaseSession
	mustUnmarshalAPIJSON(body, &session)
	if session.SessionID == "" {
		fatal("database session response did not include a sessionId")
	}
	return session
}

func endAIDatabaseSession(sessionID string, cfg *CLIConfig) {
	if strings.TrimSpace(sessionID) == "" {
		return
	}
	if _, _, err := apiPost("/api/sessions/database/"+url.PathEscape(sessionID)+"/end", map[string]any{}, cfg); err != nil && verbose {
		fmt.Fprintf(os.Stderr, "Warning: failed to close AI database session %s: %v\n", sessionID, err)
	}
}

func fetchAIExecutionPlan(sessionID, sqlText string, cfg *CLIConfig) any {
	body, status, err := apiPost("/api/sessions/database/"+url.PathEscape(sessionID)+"/explain", map[string]any{
		"sql": sqlText,
	}, cfg)
	if err != nil || status < 200 || status >= 300 {
		return nil
	}

	var plan aiExecutionPlanResponse
	if err := json.Unmarshal(body, &plan); err != nil {
		return nil
	}
	return plan.Plan
}

func printAIReviewOutput(summaryBody []byte, summaryColumns []Column, requests any, requestColumns []Column, label string) {
	if outputFormat == "json" || outputFormat == "yaml" {
		if err := printer().PrintSingle(summaryBody, nil); err != nil {
			fatal("print AI review output: %v", err)
		}
		return
	}

	if err := printer().PrintSingle(summaryBody, summaryColumns); err != nil {
		fatal("print AI review summary: %v", err)
	}
	fmt.Println()
	fmt.Println(label + ":")
	if err := printer().Print(mustMarshalJSON(requests), requestColumns); err != nil {
		fatal("print AI review requests: %v", err)
	}
}

func approvedObjectNames(requests []aiObjectRequest) []string {
	approved := make([]string, 0, len(requests))
	for _, item := range requests {
		name := strings.TrimSpace(item.Name)
		if name == "" {
			continue
		}
		schema := strings.TrimSpace(item.Schema)
		if schema != "" {
			approved = append(approved, schema+"."+name)
			continue
		}
		approved = append(approved, name)
	}
	return approved
}

func buildApprovedOptimizationData(requests []aiDataRequest, fetch func(aiDataRequest) (any, error)) map[string]any {
	approved := make(map[string]any, len(requests))
	for _, req := range requests {
		if strings.TrimSpace(req.Type) == "" || strings.EqualFold(req.Type, "custom_query") {
			continue
		}
		key := strings.TrimSpace(req.Type) + "_" + strings.TrimSpace(req.Target)
		value, err := fetch(req)
		if err != nil {
			approved[key] = map[string]any{"error": "fetch_failed"}
			continue
		}
		approved[key] = value
	}
	return approved
}

func mustUnmarshalAPIJSON(data []byte, out any) {
	if err := json.Unmarshal(data, out); err != nil {
		fatal("parse response: %v", err)
	}
}
