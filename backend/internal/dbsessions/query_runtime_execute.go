package dbsessions

import (
	"context"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func (s Service) executeOwnedQuery(ctx context.Context, userID, tenantID, tenantRole, sessionID, sqlText, ipAddress string) (contracts.QueryExecutionResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	queryType := classifyDBQuery(sqlText)
	tablesAccessed := extractTablesAccessed(sqlText)
	primaryTable := ""
	if len(tablesAccessed) > 0 {
		primaryTable = tablesAccessed[0]
	}

	if err := validateWritableQueryAccess(queryType, tenantRole, false); err != nil {
		blockReason := err.Error()
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sessionID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": blockReason,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, err
	}

	firewallResult := s.evaluateFirewallWithSettings(ctx, tenantID, runtime.Settings, sqlText, runtime.DatabaseName, primaryTable)
	if !firewallResult.Allowed {
		blockReason := "Blocked by SQL firewall"
		if strings.TrimSpace(firewallResult.RuleName) != "" {
			blockReason = "Blocked by firewall rule: " + firewallResult.RuleName
		}
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sessionID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":      sessionID,
			"protocol":       "DATABASE",
			"queryType":      string(queryType),
			"blockReason":    blockReason,
			"firewallRule":   firewallResult.RuleName,
			"firewallAction": firewallResult.Action,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, &requestError{status: http.StatusForbidden, message: blockReason}
	}
	if firewallResult.Matched && firewallResult.Action != "BLOCK" {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_FIREWALL_ALERT", runtime.Connection.ID, map[string]any{
			"sessionId":      sessionID,
			"protocol":       "DATABASE",
			"queryType":      string(queryType),
			"tablesAccessed": tablesAccessed,
			"firewallAction": firewallResult.Action,
			"firewallRule":   firewallResult.RuleName,
		}, ipAddress)
	}

	rateLimit := s.evaluateRateLimitWithSettings(ctx, userID, tenantID, runtime.Connection.ID, runtime.Settings, queryType, tenantRole, runtime.DatabaseName, primaryTable)
	if rateLimit.Matched && !rateLimit.Allowed {
		blockReason := "Rate limit exceeded: " + rateLimit.PolicyName
		s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sessionID, sqlText, nil, nil, true, blockReason, nil)
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":       sessionID,
			"protocol":        "DATABASE",
			"queryType":       string(queryType),
			"blockReason":     blockReason,
			"rateLimitPolicy": rateLimit.PolicyName,
			"retryAfterMs":    rateLimit.RetryAfterMS,
		}, ipAddress)
		return contracts.QueryExecutionResponse{}, &requestError{status: http.StatusTooManyRequests, message: blockReason}
	}
	if rateLimit.Matched && rateLimit.RetryAfterMS > 0 {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_RATE_LIMITED", runtime.Connection.ID, map[string]any{
			"sessionId":       sessionID,
			"protocol":        "DATABASE",
			"queryType":       string(queryType),
			"rateLimitPolicy": rateLimit.PolicyName,
			"action":          rateLimit.Action,
			"remaining":       rateLimit.Remaining,
		}, ipAddress)
	}

	result, err := s.executeViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryExecutionRequest{
		SQL:     sqlText,
		MaxRows: queryMaxRows(),
		Target:  runtime.Target,
	})
	if err != nil {
		return contracts.QueryExecutionResponse{}, classifyQueryOperationError(err)
	}

	executionPlan := s.captureStoredExecutionPlan(ctx, runtime, sqlText)

	policies := s.loadMaskingPoliciesWithSettings(ctx, tenantID, runtime.Settings)
	maskedColumns := findMaskedColumns(policies, result.Columns, tenantRole, runtime.DatabaseName, primaryTable)
	if len(maskedColumns) > 0 {
		result.Rows = applyMasking(result.Rows, maskedColumns)
	}

	rowsAffected := result.RowCount
	executionTimeMS := int(result.DurationMs)
	firewallNote := ""
	if firewallResult.Matched && firewallResult.Action != "BLOCK" && strings.TrimSpace(firewallResult.RuleName) != "" {
		firewallNote = "Firewall " + firewallResult.Action + ": " + firewallResult.RuleName
	}
	s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sessionID, sqlText, &rowsAffected, &executionTimeMS, false, firewallNote, executionPlan)
	s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_EXECUTED", runtime.Connection.ID, map[string]any{
		"sessionId":       sessionID,
		"protocol":        "DATABASE",
		"queryType":       string(queryType),
		"tablesAccessed":  tablesAccessed,
		"rowsAffected":    result.RowCount,
		"executionTimeMs": result.DurationMs,
		"firewallAction":  firewallResult.Action,
		"firewallRule":    firewallResult.RuleName,
	}, ipAddress)
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)

	return result, nil
}

func (s Service) fetchOwnedSchema(ctx context.Context, userID, tenantID, sessionID string) (contracts.SchemaInfo, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	result, err := s.fetchSchemaViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.SchemaFetchRequest{Target: runtime.Target})
	if err != nil {
		return contracts.SchemaInfo{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) explainOwnedQuery(ctx context.Context, userID, tenantID, tenantRole, sessionID, sqlText, ipAddress string) (contracts.QueryPlanResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}

	queryType := classifyDBQuery(sqlText)
	tablesAccessed := extractTablesAccessed(sqlText)
	primaryTable := ""
	if len(tablesAccessed) > 0 {
		primaryTable = tablesAccessed[0]
	}

	if err := validateWritableQueryAccess(queryType, tenantRole, true); err != nil {
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": err.Error(),
			"context":     "explain",
		}, ipAddress)
		return contracts.QueryPlanResponse{}, err
	}

	firewallResult := s.evaluateFirewallWithSettings(ctx, tenantID, runtime.Settings, sqlText, runtime.DatabaseName, primaryTable)
	if !firewallResult.Allowed {
		blockReason := "Blocked by SQL firewall"
		if strings.TrimSpace(firewallResult.RuleName) != "" {
			blockReason = "Blocked by firewall rule: " + firewallResult.RuleName
		}
		s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_BLOCKED", runtime.Connection.ID, map[string]any{
			"sessionId":   sessionID,
			"protocol":    "DATABASE",
			"queryType":   string(queryType),
			"blockReason": blockReason,
			"context":     "explain",
		}, ipAddress)
		return contracts.QueryPlanResponse{}, &requestError{status: http.StatusForbidden, message: blockReason}
	}

	result, err := s.explainViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryPlanRequest{
		SQL:    sqlText,
		Target: runtime.Target,
	})
	if err != nil {
		return contracts.QueryPlanResponse{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) introspectOwnedQuery(ctx context.Context, userID, tenantID, sessionID, introspectionType, target string) (contracts.QueryIntrospectionResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}

	result, err := s.introspectViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.QueryIntrospectionRequest{
		Type:   introspectionType,
		Target: target,
		DB:     runtime.Target,
	})
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, classifyQueryOperationError(err)
	}
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)
	return result, nil
}

func (s Service) FetchOwnedSchemaTables(ctx context.Context, userID, tenantID, sessionID string) ([]contracts.SchemaTable, string, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return nil, "", err
	}

	result, err := s.fetchSchemaViaDBProxy(ctx, runtime.GatewayID, runtime.InstanceID, contracts.SchemaFetchRequest{
		Target: runtime.Target,
	})
	if err != nil {
		return nil, runtime.Protocol, classifyQueryOperationError(err)
	}
	return result.Tables, runtime.Protocol, nil
}
