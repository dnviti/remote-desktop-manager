package dbsessions

import (
	"context"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type ownedQueryProxyClient struct {
	service   Service
	ctx       context.Context
	runtime   *ownedQueryRuntime
	principal dbProxyPrincipal
}

func (s Service) ownedQueryProxyClient(ctx context.Context, userID, tenantID string, runtime *ownedQueryRuntime) (ownedQueryProxyClient, error) {
	principal, err := s.dbProxyPrincipal(ctx, tenantID, userID)
	if err != nil {
		return ownedQueryProxyClient{}, err
	}
	return ownedQueryProxyClient{
		service:   s,
		ctx:       ctx,
		runtime:   runtime,
		principal: principal,
	}, nil
}

func (c ownedQueryProxyClient) execute(sqlText string) (contracts.QueryExecutionResponse, error) {
	return c.service.executeViaDBProxy(c.ctx, c.runtime.GatewayID, c.runtime.InstanceID, contracts.QueryExecutionRequest{
		SQL:     sqlText,
		MaxRows: queryMaxRows(),
		Target:  c.runtime.Target,
	}, c.principal)
}

func (c ownedQueryProxyClient) fetchSchema() (contracts.SchemaInfo, error) {
	return c.service.fetchSchemaViaDBProxy(c.ctx, c.runtime.GatewayID, c.runtime.InstanceID, contracts.SchemaFetchRequest{
		Target: c.runtime.Target,
	}, c.principal)
}

func (c ownedQueryProxyClient) explain(sqlText string) (contracts.QueryPlanResponse, error) {
	return c.service.explainViaDBProxy(c.ctx, c.runtime.GatewayID, c.runtime.InstanceID, contracts.QueryPlanRequest{
		SQL:    sqlText,
		Target: c.runtime.Target,
	}, c.principal)
}

func (c ownedQueryProxyClient) introspect(introspectionType, target string) (contracts.QueryIntrospectionResponse, error) {
	return c.service.introspectViaDBProxy(c.ctx, c.runtime.GatewayID, c.runtime.InstanceID, contracts.QueryIntrospectionRequest{
		Type:   introspectionType,
		Target: target,
		DB:     c.runtime.Target,
	}, c.principal)
}

func (c ownedQueryProxyClient) captureStoredExecutionPlan(sqlText string) any {
	if c.runtime == nil || !c.runtime.PersistExecutionPlan {
		return nil
	}
	if !supportsStoredExecutionPlan(c.runtime.Protocol) {
		return contracts.QueryPlanResponse{Supported: false}
	}

	plan, err := c.explain(sqlText)
	if err != nil {
		return nil
	}
	return plan
}
