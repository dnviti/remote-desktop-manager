package dbsessions

import (
	"context"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func (s Service) executeOwnedQuery(ctx context.Context, userID, tenantID, tenantRole, sessionID, sqlText, ipAddress string) (contracts.QueryExecutionResponse, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	policy, err := s.evaluateOwnedQueryPolicy(ctx, ownedQueryPolicyInput{
		UserID:     userID,
		TenantID:   tenantID,
		TenantRole: tenantRole,
		SessionID:  sessionID,
		SQLText:    sqlText,
		IPAddress:  ipAddress,
		Runtime:    runtime,
		Mode:       ownedQueryPolicyExecute,
	})
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}

	proxy, err := s.ownedQueryProxyClient(ctx, userID, tenantID, runtime)
	if err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	result, err := proxy.execute(sqlText)
	if err != nil {
		return contracts.QueryExecutionResponse{}, classifyQueryOperationError(err)
	}

	executionPlan := proxy.captureStoredExecutionPlan(sqlText)

	policies := s.loadMaskingPoliciesWithSettings(ctx, tenantID, runtime.Settings)
	maskedColumns := findMaskedColumns(policies, result.Columns, tenantRole, runtime.DatabaseName, policy.Analysis.PrimaryTable)
	if len(maskedColumns) > 0 {
		result.Rows = applyMasking(result.Rows, maskedColumns)
	}

	rowsAffected := result.RowCount
	executionTimeMS := int(result.DurationMs)
	s.interceptQuery(ctx, userID, runtime.Connection.ID, tenantID, sessionID, sqlText, &rowsAffected, &executionTimeMS, false, policy.firewallNote(), executionPlan)
	s.insertQueryAuditEvent(ctx, userID, "DB_QUERY_EXECUTED", runtime.Connection.ID, map[string]any{
		"sessionId":       sessionID,
		"protocol":        "DATABASE",
		"queryType":       string(policy.Analysis.QueryType),
		"tablesAccessed":  policy.Analysis.TablesAccessed,
		"rowsAffected":    result.RowCount,
		"executionTimeMs": result.DurationMs,
		"firewallAction":  policy.Firewall.Action,
		"firewallRule":    policy.Firewall.RuleName,
	}, ipAddress)
	_ = s.touchOwnedSession(ctx, runtime.State.Record.ID)

	return result, nil
}

func (s Service) fetchOwnedSchema(ctx context.Context, userID, tenantID, sessionID string) (contracts.SchemaInfo, error) {
	runtime, err := s.resolveOwnedQueryRuntime(ctx, userID, tenantID, sessionID)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	proxy, err := s.ownedQueryProxyClient(ctx, userID, tenantID, runtime)
	if err != nil {
		return contracts.SchemaInfo{}, err
	}
	result, err := proxy.fetchSchema()
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

	if _, err := s.evaluateOwnedQueryPolicy(ctx, ownedQueryPolicyInput{
		UserID:     userID,
		TenantID:   tenantID,
		TenantRole: tenantRole,
		SessionID:  sessionID,
		SQLText:    sqlText,
		IPAddress:  ipAddress,
		Runtime:    runtime,
		Mode:       ownedQueryPolicyExplain,
	}); err != nil {
		return contracts.QueryPlanResponse{}, err
	}

	proxy, err := s.ownedQueryProxyClient(ctx, userID, tenantID, runtime)
	if err != nil {
		return contracts.QueryPlanResponse{}, err
	}
	result, err := proxy.explain(sqlText)
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

	proxy, err := s.ownedQueryProxyClient(ctx, userID, tenantID, runtime)
	if err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	result, err := proxy.introspect(introspectionType, target)
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

	proxy, err := s.ownedQueryProxyClient(ctx, userID, tenantID, runtime)
	if err != nil {
		return nil, "", err
	}
	result, err := proxy.fetchSchema()
	if err != nil {
		return nil, runtime.Protocol, classifyQueryOperationError(err)
	}
	return result.Tables, runtime.Protocol, nil
}
