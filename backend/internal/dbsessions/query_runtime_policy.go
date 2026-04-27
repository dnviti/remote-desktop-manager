package dbsessions

import (
	"context"
	"net/http"
	"strings"
)

type ownedQueryPolicyMode string

const (
	ownedQueryPolicyExecute ownedQueryPolicyMode = "execute"
	ownedQueryPolicyExplain ownedQueryPolicyMode = "explain"
)

type dbQueryAnalysis struct {
	QueryType      dbQueryType
	TablesAccessed []string
	PrimaryTable   string
}

type ownedQueryPolicyInput struct {
	UserID     string
	TenantID   string
	TenantRole string
	SessionID  string
	SQLText    string
	IPAddress  string
	Runtime    *ownedQueryRuntime
	Mode       ownedQueryPolicyMode
}

type ownedQueryPolicyEvaluation struct {
	Analysis  dbQueryAnalysis
	Firewall  firewallEvaluation
	RateLimit rateLimitEvaluation
}

func analyzeDBQuery(sqlText string) dbQueryAnalysis {
	tablesAccessed := extractTablesAccessed(sqlText)
	primaryTable := ""
	if len(tablesAccessed) > 0 {
		primaryTable = tablesAccessed[0]
	}
	return dbQueryAnalysis{
		QueryType:      classifyDBQuery(sqlText),
		TablesAccessed: tablesAccessed,
		PrimaryTable:   primaryTable,
	}
}

func (s Service) evaluateOwnedQueryPolicy(ctx context.Context, input ownedQueryPolicyInput) (ownedQueryPolicyEvaluation, error) {
	evaluation := ownedQueryPolicyEvaluation{
		Analysis: analyzeDBQuery(input.SQLText),
	}
	if input.Runtime == nil {
		return evaluation, &requestError{status: http.StatusServiceUnavailable, message: "database session runtime is unavailable"}
	}

	if err := validateWritableQueryAccess(evaluation.Analysis.QueryType, input.TenantRole, input.Mode == ownedQueryPolicyExplain); err != nil {
		s.recordOwnedQueryBlock(ctx, input, evaluation, err.Error(), input.auditContext())
		return evaluation, err
	}

	evaluation.Firewall = s.evaluateFirewallWithSettings(
		ctx,
		input.TenantID,
		input.Runtime.Settings,
		input.SQLText,
		input.Runtime.DatabaseName,
		evaluation.Analysis.PrimaryTable,
	)
	if !evaluation.Firewall.Allowed {
		blockReason := firewallBlockReason(evaluation.Firewall)
		details := input.auditContext()
		if input.Mode == ownedQueryPolicyExecute {
			details = map[string]any{
				"firewallRule":   evaluation.Firewall.RuleName,
				"firewallAction": evaluation.Firewall.Action,
			}
		}
		s.recordOwnedQueryBlock(ctx, input, evaluation, blockReason, details)
		return evaluation, &requestError{status: http.StatusForbidden, message: blockReason}
	}
	if input.Mode == ownedQueryPolicyExecute && evaluation.Firewall.Matched && evaluation.Firewall.Action != "BLOCK" {
		s.insertQueryAuditEvent(ctx, input.UserID, "DB_QUERY_FIREWALL_ALERT", input.Runtime.Connection.ID, map[string]any{
			"sessionId":      input.SessionID,
			"protocol":       "DATABASE",
			"queryType":      string(evaluation.Analysis.QueryType),
			"tablesAccessed": evaluation.Analysis.TablesAccessed,
			"firewallAction": evaluation.Firewall.Action,
			"firewallRule":   evaluation.Firewall.RuleName,
		}, input.IPAddress)
	}

	if input.Mode != ownedQueryPolicyExecute {
		return evaluation, nil
	}

	evaluation.RateLimit = s.evaluateRateLimitWithSettings(
		ctx,
		input.UserID,
		input.TenantID,
		input.Runtime.Connection.ID,
		input.Runtime.Settings,
		evaluation.Analysis.QueryType,
		input.TenantRole,
		input.Runtime.DatabaseName,
		evaluation.Analysis.PrimaryTable,
	)
	if evaluation.RateLimit.Matched && !evaluation.RateLimit.Allowed {
		blockReason := "Rate limit exceeded: " + evaluation.RateLimit.PolicyName
		s.recordOwnedQueryBlock(ctx, input, evaluation, blockReason, map[string]any{
			"rateLimitPolicy": evaluation.RateLimit.PolicyName,
			"retryAfterMs":    evaluation.RateLimit.RetryAfterMS,
		})
		return evaluation, &requestError{status: http.StatusTooManyRequests, message: blockReason}
	}
	if evaluation.RateLimit.Matched && evaluation.RateLimit.RetryAfterMS > 0 {
		s.insertQueryAuditEvent(ctx, input.UserID, "DB_QUERY_RATE_LIMITED", input.Runtime.Connection.ID, map[string]any{
			"sessionId":       input.SessionID,
			"protocol":        "DATABASE",
			"queryType":       string(evaluation.Analysis.QueryType),
			"rateLimitPolicy": evaluation.RateLimit.PolicyName,
			"action":          evaluation.RateLimit.Action,
			"remaining":       evaluation.RateLimit.Remaining,
		}, input.IPAddress)
	}

	return evaluation, nil
}

func (s Service) recordOwnedQueryBlock(ctx context.Context, input ownedQueryPolicyInput, evaluation ownedQueryPolicyEvaluation, blockReason string, details map[string]any) {
	if input.Mode == ownedQueryPolicyExecute {
		s.interceptQuery(ctx, input.UserID, input.Runtime.Connection.ID, input.TenantID, input.SessionID, input.SQLText, nil, nil, true, blockReason, nil)
	}
	payload := map[string]any{
		"sessionId":   input.SessionID,
		"protocol":    "DATABASE",
		"queryType":   string(evaluation.Analysis.QueryType),
		"blockReason": blockReason,
	}
	for key, value := range details {
		payload[key] = value
	}
	s.insertQueryAuditEvent(ctx, input.UserID, "DB_QUERY_BLOCKED", input.Runtime.Connection.ID, payload, input.IPAddress)
}

func (input ownedQueryPolicyInput) auditContext() map[string]any {
	if input.Mode == ownedQueryPolicyExplain {
		return map[string]any{"context": "explain"}
	}
	return nil
}

func firewallBlockReason(result firewallEvaluation) string {
	if strings.TrimSpace(result.RuleName) != "" {
		return "Blocked by firewall rule: " + result.RuleName
	}
	return "Blocked by SQL firewall"
}

func (evaluation ownedQueryPolicyEvaluation) firewallNote() string {
	if evaluation.Firewall.Matched && evaluation.Firewall.Action != "BLOCK" && strings.TrimSpace(evaluation.Firewall.RuleName) != "" {
		return "Firewall " + evaluation.Firewall.Action + ": " + evaluation.Firewall.RuleName
	}
	return ""
}
