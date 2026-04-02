package dbsessions

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

const dbProxyRequestTimeout = 30 * time.Second

func (s Service) validateTargetViaDBProxy(ctx context.Context, gatewayID, instanceID string, target *contracts.DatabaseTarget) error {
	var response contracts.DatabaseConnectivityResponse
	return s.callDBProxy(ctx, gatewayID, instanceID, "/v1/connectivity:validate", contracts.DatabaseConnectivityRequest{
		Target: target,
	}, &response)
}

func (s Service) executeViaDBProxy(ctx context.Context, gatewayID, instanceID string, req contracts.QueryExecutionRequest) (contracts.QueryExecutionResponse, error) {
	var response contracts.QueryExecutionResponse
	if err := s.callDBProxy(ctx, gatewayID, instanceID, "/v1/query-runs:execute-any", req, &response); err != nil {
		return contracts.QueryExecutionResponse{}, err
	}
	return response, nil
}

func (s Service) fetchSchemaViaDBProxy(ctx context.Context, gatewayID, instanceID string, req contracts.SchemaFetchRequest) (contracts.SchemaInfo, error) {
	var response contracts.SchemaInfo
	if err := s.callDBProxy(ctx, gatewayID, instanceID, "/v1/schema:fetch", req, &response); err != nil {
		return contracts.SchemaInfo{}, err
	}
	return response, nil
}

func (s Service) explainViaDBProxy(ctx context.Context, gatewayID, instanceID string, req contracts.QueryPlanRequest) (contracts.QueryPlanResponse, error) {
	var response contracts.QueryPlanResponse
	if err := s.callDBProxy(ctx, gatewayID, instanceID, "/v1/query-plans:explain", req, &response); err != nil {
		return contracts.QueryPlanResponse{}, err
	}
	return response, nil
}

func (s Service) introspectViaDBProxy(ctx context.Context, gatewayID, instanceID string, req contracts.QueryIntrospectionRequest) (contracts.QueryIntrospectionResponse, error) {
	var response contracts.QueryIntrospectionResponse
	if err := s.callDBProxy(ctx, gatewayID, instanceID, "/v1/introspection:run", req, &response); err != nil {
		return contracts.QueryIntrospectionResponse{}, err
	}
	return response, nil
}

func (s Service) callDBProxy(ctx context.Context, gatewayID, instanceID, path string, payload any, out any) error {
	baseURL, err := s.dbProxyBaseURL(ctx, gatewayID, instanceID)
	if err != nil {
		return err
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal db-proxy request: %w", err)
	}

	requestCtx, cancel := context.WithTimeout(ctx, dbProxyRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(
		requestCtx,
		http.MethodPost,
		strings.TrimRight(baseURL, "/")+path,
		bytes.NewReader(body),
	)
	if err != nil {
		return fmt.Errorf("build db-proxy request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Close = true

	resp, err := s.dbProxyHTTPClient().Do(req)
	if err != nil {
		return fmt.Errorf("call db-proxy: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return decodeDBProxyError(resp)
	}

	if out == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("decode db-proxy response: %w", err)
	}
	return nil
}

func (s Service) dbProxyBaseURL(ctx context.Context, gatewayID, instanceID string) (string, error) {
	gatewayID = strings.TrimSpace(gatewayID)
	if gatewayID == "" {
		return "", &requestError{status: http.StatusBadGateway, message: "database session gateway is unavailable"}
	}

	gateway, err := s.loadGatewayByID(ctx, gatewayID)
	if err != nil {
		return "", err
	}
	if gateway == nil {
		return "", &requestError{status: http.StatusBadGateway, message: "database session gateway is unavailable"}
	}
	if gateway.Type != "DB_PROXY" {
		return "", &requestError{status: http.StatusBadGateway, message: "database session gateway is not a DB_PROXY"}
	}

	host := strings.TrimSpace(gateway.Host)
	port := gateway.Port
	if strings.EqualFold(strings.TrimSpace(gateway.DeploymentMode), "MANAGED_GROUP") {
		selected, err := s.resolveManagedDBProxyInstance(ctx, gateway.ID, instanceID, gateway.LBStrategy, gateway.TunnelEnabled)
		if err != nil {
			return "", err
		}
		if selected != nil {
			host = strings.TrimSpace(selected.Host)
			port = selected.Port
		}
	}

	if port <= 0 {
		return "", &requestError{status: http.StatusBadGateway, message: "database session gateway port is unavailable"}
	}
	if gateway.TunnelEnabled {
		proxy, err := s.ConnectionResolver.CreateTunnelProxy(ctx, gateway.ID, "127.0.0.1", port)
		if err != nil {
			return "", err
		}
		host = strings.TrimSpace(proxy.Host)
		port = proxy.Port
	}
	if host == "" {
		return "", &requestError{status: http.StatusBadGateway, message: "database session gateway host is unavailable"}
	}

	return "http://" + net.JoinHostPort(host, strconv.Itoa(port)), nil
}

func (s Service) resolveManagedDBProxyInstance(ctx context.Context, gatewayID, instanceID, strategy string, tunnelEnabled bool) (*managedGatewayInstance, error) {
	instanceID = strings.TrimSpace(instanceID)
	if instanceID != "" {
		instance, err := s.loadManagedDBProxyInstance(ctx, gatewayID, instanceID)
		if err != nil {
			return nil, err
		}
		if instance != nil {
			return instance, nil
		}
	}

	selected, err := s.selectManagedInstance(ctx, gatewayID, strategy)
	if err != nil {
		return nil, err
	}
	if selected == nil && !tunnelEnabled {
		return nil, &requestError{
			status:  http.StatusServiceUnavailable,
			message: "No healthy DB proxy instances available. The gateway may be scaling — please try again.",
		}
	}
	return selected, nil
}

func (s Service) loadManagedDBProxyInstance(ctx context.Context, gatewayID, instanceID string) (*managedGatewayInstance, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	var item managedGatewayInstance
	if err := s.DB.QueryRow(ctx, `
SELECT
	i.id,
	COALESCE(NULLIF(i.host, ''), NULLIF(i."containerName", '')) AS host,
	COALESCE(NULLIF(i.port, 0), g.port) AS port,
	i."createdAt",
	0::int AS active_sessions
FROM "ManagedGatewayInstance" i
JOIN "Gateway" g
	ON g.id = i."gatewayId"
WHERE i.id = $1
  AND i."gatewayId" = $2
  AND i.status = 'RUNNING'::"ManagedInstanceStatus"
  AND COALESCE(i."healthStatus", '') = 'healthy'
`, instanceID, gatewayID).Scan(&item.ID, &item.Host, &item.Port, &item.CreatedAt, &item.ActiveSessions); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load managed db-proxy instance: %w", err)
	}
	return &item, nil
}

func (s Service) dbProxyHTTPClient() *http.Client {
	if s.ConnectionResolver.HTTPClient != nil {
		client := *s.ConnectionResolver.HTTPClient
		if client.Timeout <= 0 {
			client.Timeout = dbProxyRequestTimeout
		}
		return &client
	}
	return &http.Client{Timeout: dbProxyRequestTimeout}
}

func decodeDBProxyError(resp *http.Response) error {
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err == nil {
		if message, _ := payload["error"].(string); strings.TrimSpace(message) != "" {
			return fmt.Errorf("%s", strings.TrimSpace(message))
		}
	}
	return fmt.Errorf("db-proxy returned status %d", resp.StatusCode)
}
