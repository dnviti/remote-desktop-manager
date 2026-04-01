package gateways

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
)

type scalingConfigPayload struct {
	AutoScale                optionalBool `json:"autoScale"`
	MinReplicas              optionalInt  `json:"minReplicas"`
	MaxReplicas              optionalInt  `json:"maxReplicas"`
	SessionsPerInstance      optionalInt  `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds optionalInt  `json:"scaleDownCooldownSeconds"`
}

type scalingStatusResponse struct {
	GatewayID                string                   `json:"gatewayId"`
	AutoScale                bool                     `json:"autoScale"`
	MinReplicas              int                      `json:"minReplicas"`
	MaxReplicas              int                      `json:"maxReplicas"`
	SessionsPerInstance      int                      `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds int                      `json:"scaleDownCooldownSeconds"`
	CurrentReplicas          int                      `json:"currentReplicas"`
	ActiveSessions           int                      `json:"activeSessions"`
	TargetReplicas           int                      `json:"targetReplicas"`
	LastScaleAction          *time.Time               `json:"lastScaleAction"`
	CooldownRemaining        int                      `json:"cooldownRemaining"`
	Recommendation           string                   `json:"recommendation"`
	InstanceSessions         []instanceSessionSummary `json:"instanceSessions"`
}

type instanceSessionSummary struct {
	InstanceID    string `json:"instanceId"`
	ContainerName string `json:"containerName"`
	Count         int    `json:"count"`
}

type scalingConfigResponse struct {
	ID                       string     `json:"id"`
	AutoScale                bool       `json:"autoScale"`
	MinReplicas              int        `json:"minReplicas"`
	MaxReplicas              int        `json:"maxReplicas"`
	SessionsPerInstance      int        `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds int        `json:"scaleDownCooldownSeconds"`
	LastScaleAction          *time.Time `json:"lastScaleAction"`
}

func (s Service) GetScalingStatus(ctx context.Context, tenantID, gatewayID string) (scalingStatusResponse, error) {
	if s.DB == nil {
		return scalingStatusResponse{}, fmt.Errorf("database is unavailable")
	}

	gateway, err := s.loadGateway(ctx, tenantID, gatewayID)
	if err != nil {
		return scalingStatusResponse{}, err
	}
	return s.buildScalingStatus(ctx, gateway)
}

func (s Service) UpdateScalingConfig(ctx context.Context, claims authn.Claims, gatewayID string, input scalingConfigPayload, ipAddress string) (scalingConfigResponse, error) {
	if s.DB == nil {
		return scalingConfigResponse{}, fmt.Errorf("database is unavailable")
	}

	gateway, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return scalingConfigResponse{}, err
	}
	if !deploymentModeIsGroup(gateway.DeploymentMode) {
		return scalingConfigResponse{}, &requestError{status: http.StatusBadRequest, message: "Auto-scaling is only available for MANAGED_GROUP gateways"}
	}
	if err := validateScalingConfigPayload(gateway, input); err != nil {
		return scalingConfigResponse{}, err
	}

	autoScale := chooseBool(gateway.AutoScale, input.AutoScale)
	minReplicas := chooseInt(gateway.MinReplicas, input.MinReplicas)
	maxReplicas := chooseInt(gateway.MaxReplicas, input.MaxReplicas)
	sessionsPerInstance := chooseInt(gateway.SessionsPerInstance, input.SessionsPerInstance)
	scaleDownCooldownSeconds := chooseInt(gateway.ScaleDownCooldownSeconds, input.ScaleDownCooldownSeconds)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return scalingConfigResponse{}, fmt.Errorf("begin scaling update transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var response scalingConfigResponse
	var lastScaleAction sql.NullTime
	if err := tx.QueryRow(ctx, `
UPDATE "Gateway"
   SET "autoScale" = $2,
       "minReplicas" = $3,
       "maxReplicas" = $4,
       "sessionsPerInstance" = $5,
       "scaleDownCooldownSeconds" = $6,
       "updatedAt" = NOW()
 WHERE id = $1
 RETURNING id, "autoScale", "minReplicas", "maxReplicas", "sessionsPerInstance", "scaleDownCooldownSeconds", "lastScaleAction"
`, gatewayID, autoScale, minReplicas, maxReplicas, sessionsPerInstance, scaleDownCooldownSeconds).Scan(&response.ID, &response.AutoScale, &response.MinReplicas, &response.MaxReplicas, &response.SessionsPerInstance, &response.ScaleDownCooldownSeconds, &lastScaleAction); err != nil {
		return scalingConfigResponse{}, fmt.Errorf("update scaling config: %w", err)
	}
	response.LastScaleAction = nullTimePtr(lastScaleAction)

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_UPDATE", gatewayID, map[string]any{
		"scalingConfig": changedScalingDetails(input),
	}, ipAddress); err != nil {
		return scalingConfigResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return scalingConfigResponse{}, fmt.Errorf("commit scaling update transaction: %w", err)
	}

	return response, nil
}

func (s Service) buildScalingStatus(ctx context.Context, gateway gatewayRecord) (scalingStatusResponse, error) {
	activeSessions, err := s.countGatewayActiveSessions(ctx, gateway.ID)
	if err != nil {
		return scalingStatusResponse{}, err
	}
	currentReplicas, err := s.countCurrentGatewayReplicas(ctx, gateway.ID)
	if err != nil {
		return scalingStatusResponse{}, err
	}
	instanceSessions, err := s.listInstanceSessions(ctx, gateway.ID)
	if err != nil {
		return scalingStatusResponse{}, err
	}

	return computeScalingStatus(gateway, activeSessions, currentReplicas, instanceSessions, time.Now()), nil
}

func (s Service) countGatewayActiveSessions(ctx context.Context, gatewayID string) (int, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "ActiveSession"
WHERE "gatewayId" = $1
  AND status <> 'CLOSED'::"SessionStatus"
`, gatewayID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count gateway active sessions: %w", err)
	}
	return count, nil
}

func (s Service) countCurrentGatewayReplicas(ctx context.Context, gatewayID string) (int, error) {
	var count int
	if err := s.DB.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "ManagedGatewayInstance"
WHERE "gatewayId" = $1
  AND status IN ('RUNNING'::"ManagedInstanceStatus", 'PROVISIONING'::"ManagedInstanceStatus")
`, gatewayID).Scan(&count); err != nil {
		return 0, fmt.Errorf("count managed gateway instances: %w", err)
	}
	return count, nil
}

func (s Service) listInstanceSessions(ctx context.Context, gatewayID string) ([]instanceSessionSummary, error) {
	rows, err := s.DB.Query(ctx, `
SELECT i.id, i."containerName", COUNT(s.id)::int AS session_count
FROM "ManagedGatewayInstance" i
LEFT JOIN "ActiveSession" s
  ON s."instanceId" = i.id
 AND s.status <> 'CLOSED'::"SessionStatus"
WHERE i."gatewayId" = $1
  AND i.status IN ('RUNNING'::"ManagedInstanceStatus", 'PROVISIONING'::"ManagedInstanceStatus")
GROUP BY i.id, i."containerName", i."createdAt"
ORDER BY i."createdAt" ASC
`, gatewayID)
	if err != nil {
		return nil, fmt.Errorf("list managed gateway instance sessions: %w", err)
	}
	defer rows.Close()

	result := make([]instanceSessionSummary, 0)
	for rows.Next() {
		var item instanceSessionSummary
		if err := rows.Scan(&item.InstanceID, &item.ContainerName, &item.Count); err != nil {
			return nil, fmt.Errorf("scan managed gateway instance sessions: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate managed gateway instance sessions: %w", err)
	}
	return result, nil
}

func validateScalingConfigPayload(gateway gatewayRecord, input scalingConfigPayload) error {
	if input.MinReplicas.Present && input.MinReplicas.Value != nil && (*input.MinReplicas.Value < 0 || *input.MinReplicas.Value > 20) {
		return &requestError{status: http.StatusBadRequest, message: "minReplicas must be between 0 and 20"}
	}
	if input.MaxReplicas.Present && input.MaxReplicas.Value != nil && (*input.MaxReplicas.Value < 1 || *input.MaxReplicas.Value > 20) {
		return &requestError{status: http.StatusBadRequest, message: "maxReplicas must be between 1 and 20"}
	}
	if input.SessionsPerInstance.Present && input.SessionsPerInstance.Value != nil && (*input.SessionsPerInstance.Value < 1 || *input.SessionsPerInstance.Value > 100) {
		return &requestError{status: http.StatusBadRequest, message: "sessionsPerInstance must be between 1 and 100"}
	}
	if input.ScaleDownCooldownSeconds.Present && input.ScaleDownCooldownSeconds.Value != nil && (*input.ScaleDownCooldownSeconds.Value < 60 || *input.ScaleDownCooldownSeconds.Value > 3600) {
		return &requestError{status: http.StatusBadRequest, message: "scaleDownCooldownSeconds must be between 60 and 3600"}
	}

	if input.MinReplicas.Present && input.MinReplicas.Value != nil && input.MaxReplicas.Present && input.MaxReplicas.Value != nil {
		if *input.MinReplicas.Value > *input.MaxReplicas.Value {
			return &requestError{status: http.StatusBadRequest, message: "minReplicas must be less than or equal to maxReplicas"}
		}
	}
	minReplicas := gateway.MinReplicas
	if input.MinReplicas.Present && input.MinReplicas.Value != nil {
		minReplicas = *input.MinReplicas.Value
	}
	maxReplicas := gateway.MaxReplicas
	if input.MaxReplicas.Present && input.MaxReplicas.Value != nil {
		maxReplicas = *input.MaxReplicas.Value
	}
	if minReplicas > maxReplicas {
		return &requestError{status: http.StatusBadRequest, message: "minReplicas cannot exceed current maxReplicas"}
	}
	if input.MaxReplicas.Present && input.MaxReplicas.Value != nil && !input.MinReplicas.Present && *input.MaxReplicas.Value < gateway.MinReplicas {
		return &requestError{status: http.StatusBadRequest, message: "maxReplicas cannot be less than current minReplicas"}
	}
	return nil
}

func changedScalingDetails(input scalingConfigPayload) map[string]any {
	details := make(map[string]any)
	if input.AutoScale.Present {
		details["autoScale"] = boolValue(input.AutoScale.Value, false)
	}
	if input.MinReplicas.Present {
		details["minReplicas"] = nullableIntValue(input.MinReplicas.Value)
	}
	if input.MaxReplicas.Present {
		details["maxReplicas"] = nullableIntValue(input.MaxReplicas.Value)
	}
	if input.SessionsPerInstance.Present {
		details["sessionsPerInstance"] = nullableIntValue(input.SessionsPerInstance.Value)
	}
	if input.ScaleDownCooldownSeconds.Present {
		details["scaleDownCooldownSeconds"] = nullableIntValue(input.ScaleDownCooldownSeconds.Value)
	}
	return details
}

func nullableIntValue(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func computeScalingStatus(gateway gatewayRecord, activeSessions, currentReplicas int, instanceSessions []instanceSessionSummary, now time.Time) scalingStatusResponse {
	targetReplicas := gateway.DesiredReplicas
	if gateway.AutoScale {
		rawTarget := 0
		if activeSessions > 0 && gateway.SessionsPerInstance > 0 {
			rawTarget = (activeSessions + gateway.SessionsPerInstance - 1) / gateway.SessionsPerInstance
		}
		targetReplicas = maxInt(gateway.MinReplicas, minInt(rawTarget, gateway.MaxReplicas))
	}

	cooldownRemaining := 0
	if gateway.AutoScale && gateway.LastScaleAction != nil {
		cooldownUntil := gateway.LastScaleAction.Add(time.Duration(gateway.ScaleDownCooldownSeconds) * time.Second)
		if until := cooldownUntil.Sub(now); until > 0 {
			cooldownRemaining = int((until + time.Second - 1) / time.Second)
		}
	}

	recommendation := "stable"
	if gateway.AutoScale {
		switch {
		case targetReplicas > currentReplicas:
			recommendation = "scale-up"
		case targetReplicas < currentReplicas:
			recommendation = "scale-down"
		}
	}

	return scalingStatusResponse{
		GatewayID:                gateway.ID,
		AutoScale:                gateway.AutoScale,
		MinReplicas:              gateway.MinReplicas,
		MaxReplicas:              gateway.MaxReplicas,
		SessionsPerInstance:      gateway.SessionsPerInstance,
		ScaleDownCooldownSeconds: gateway.ScaleDownCooldownSeconds,
		CurrentReplicas:          currentReplicas,
		ActiveSessions:           activeSessions,
		TargetReplicas:           targetReplicas,
		LastScaleAction:          gateway.LastScaleAction,
		CooldownRemaining:        cooldownRemaining,
		Recommendation:           recommendation,
		InstanceSessions:         instanceSessions,
	}
}
