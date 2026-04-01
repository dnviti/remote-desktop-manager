package gateways

import (
	"context"
	"fmt"
	"net"
	"strings"
	"time"
)

func (s Service) TestGatewayConnectivity(ctx context.Context, tenantID, gatewayID string) (connectivityResult, error) {
	if s.DB == nil {
		return connectivityResult{}, fmt.Errorf("database is unavailable")
	}

	var (
		host           string
		port           int
		gatewayType    string
		deploymentMode string
	)
	if err := s.DB.QueryRow(ctx, `
SELECT host, port, type::text, "deploymentMode"::text
  FROM "Gateway"
 WHERE id = $1
   AND "tenantId" = $2
`, gatewayID, tenantID).Scan(&host, &port, &gatewayType, &deploymentMode); err != nil {
		return connectivityResult{}, &requestError{status: 404, message: "Gateway not found"}
	}

	if strings.EqualFold(strings.TrimSpace(deploymentMode), "MANAGED_GROUP") {
		var instanceHost, instanceContainerName string
		var instancePort int
		err := s.DB.QueryRow(ctx, `
SELECT host, port, "containerName"
  FROM "ManagedGatewayInstance"
 WHERE "gatewayId" = $1
   AND status = 'RUNNING'
 ORDER BY "createdAt" ASC
 LIMIT 1
`, gatewayID).Scan(&instanceHost, &instancePort, &instanceContainerName)
		if err == nil {
			if instanceContainerName != "" {
				host = instanceContainerName
			} else {
				host = instanceHost
				port = instancePort
			}
		} else {
			message := "No deployed instances for this gateway group"
			result := connectivityResult{
				Reachable: false,
				Error:     &message,
			}
			if _, updateErr := s.DB.Exec(ctx, `
UPDATE "Gateway"
   SET "lastHealthStatus" = 'UNREACHABLE'::"GatewayHealthStatus",
       "lastCheckedAt" = NOW(),
       "lastLatencyMs" = NULL,
       "lastError" = $2,
       "updatedAt" = NOW()
 WHERE id = $1
`, gatewayID, message); updateErr != nil {
				return connectivityResult{}, fmt.Errorf("update gateway health: %w", updateErr)
			}
			return result, nil
		}
	}

	result := tcpProbe(ctx, host, port, 5*time.Second)
	status := "UNREACHABLE"
	if result.Reachable {
		status = "REACHABLE"
	}
	if _, err := s.DB.Exec(ctx, `
UPDATE "Gateway"
   SET "lastHealthStatus" = $2::"GatewayHealthStatus",
       "lastCheckedAt" = NOW(),
       "lastLatencyMs" = $3,
       "lastError" = $4,
       "updatedAt" = NOW()
 WHERE id = $1
`, gatewayID, status, result.LatencyMS, result.Error); err != nil {
		return connectivityResult{}, fmt.Errorf("update gateway health: %w", err)
	}
	return result, nil
}

func tcpProbe(ctx context.Context, host string, port int, timeout time.Duration) connectivityResult {
	start := time.Now()
	dialer := &net.Dialer{Timeout: timeout}
	conn, err := dialer.DialContext(ctx, "tcp", net.JoinHostPort(host, fmt.Sprintf("%d", port)))
	if err != nil {
		message := err.Error()
		return connectivityResult{
			Reachable: false,
			Error:     &message,
		}
	}
	_ = conn.Close()
	latency := int(time.Since(start).Milliseconds())
	return connectivityResult{
		Reachable: true,
		LatencyMS: &latency,
	}
}
