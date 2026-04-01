package gateways

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type gatewayTemplateResponse struct {
	ID                       string               `json:"id"`
	Name                     string               `json:"name"`
	Type                     string               `json:"type"`
	Host                     string               `json:"host"`
	Port                     int                  `json:"port"`
	DeploymentMode           string               `json:"deploymentMode"`
	Description              *string              `json:"description"`
	APIPort                  *int                 `json:"apiPort"`
	AutoScale                bool                 `json:"autoScale"`
	MinReplicas              int                  `json:"minReplicas"`
	MaxReplicas              int                  `json:"maxReplicas"`
	SessionsPerInstance      int                  `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds int                  `json:"scaleDownCooldownSeconds"`
	MonitoringEnabled        bool                 `json:"monitoringEnabled"`
	MonitorIntervalMS        int                  `json:"monitorIntervalMs"`
	InactivityTimeoutSeconds int                  `json:"inactivityTimeoutSeconds"`
	PublishPorts             bool                 `json:"publishPorts"`
	LBStrategy               string               `json:"lbStrategy"`
	TenantID                 string               `json:"tenantId"`
	CreatedByID              string               `json:"createdById"`
	CreatedAt                time.Time            `json:"createdAt"`
	UpdatedAt                time.Time            `json:"updatedAt"`
	Count                    gatewayTemplateCount `json:"_count"`
}

type gatewayTemplateCount struct {
	Gateways int `json:"gateways"`
}

type createTemplatePayload struct {
	Name                     string  `json:"name"`
	Type                     string  `json:"type"`
	Host                     *string `json:"host"`
	Port                     *int    `json:"port"`
	DeploymentMode           *string `json:"deploymentMode"`
	Description              *string `json:"description"`
	APIPort                  *int    `json:"apiPort"`
	AutoScale                *bool   `json:"autoScale"`
	MinReplicas              *int    `json:"minReplicas"`
	MaxReplicas              *int    `json:"maxReplicas"`
	SessionsPerInstance      *int    `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds *int    `json:"scaleDownCooldownSeconds"`
	MonitoringEnabled        *bool   `json:"monitoringEnabled"`
	MonitorIntervalMS        *int    `json:"monitorIntervalMs"`
	InactivityTimeoutSeconds *int    `json:"inactivityTimeoutSeconds"`
	PublishPorts             *bool   `json:"publishPorts"`
	LBStrategy               *string `json:"lbStrategy"`
}

type normalizedCreateTemplatePayload struct {
	Name                     string
	Type                     string
	Host                     string
	Port                     int
	DeploymentMode           string
	Description              *string
	APIPort                  *int
	AutoScale                *bool
	MinReplicas              *int
	MaxReplicas              *int
	SessionsPerInstance      *int
	ScaleDownCooldownSeconds *int
	MonitoringEnabled        *bool
	MonitorIntervalMS        *int
	InactivityTimeoutSeconds *int
	PublishPorts             *bool
	LBStrategy               *string
}

type updateTemplatePayload struct {
	Name                     optionalString `json:"name"`
	Type                     optionalString `json:"type"`
	Host                     optionalString `json:"host"`
	Port                     optionalInt    `json:"port"`
	DeploymentMode           optionalString `json:"deploymentMode"`
	Description              optionalString `json:"description"`
	APIPort                  optionalInt    `json:"apiPort"`
	AutoScale                optionalBool   `json:"autoScale"`
	MinReplicas              optionalInt    `json:"minReplicas"`
	MaxReplicas              optionalInt    `json:"maxReplicas"`
	SessionsPerInstance      optionalInt    `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds optionalInt    `json:"scaleDownCooldownSeconds"`
	MonitoringEnabled        optionalBool   `json:"monitoringEnabled"`
	MonitorIntervalMS        optionalInt    `json:"monitorIntervalMs"`
	InactivityTimeoutSeconds optionalInt    `json:"inactivityTimeoutSeconds"`
	PublishPorts             optionalBool   `json:"publishPorts"`
	LBStrategy               optionalString `json:"lbStrategy"`
}

type gatewayTemplateRecord struct {
	ID                       string
	Name                     string
	Type                     string
	Host                     string
	Port                     int
	DeploymentMode           string
	Description              *string
	APIPort                  *int
	AutoScale                bool
	MinReplicas              int
	MaxReplicas              int
	SessionsPerInstance      int
	ScaleDownCooldownSeconds int
	MonitoringEnabled        bool
	MonitorIntervalMS        int
	InactivityTimeoutSeconds int
	PublishPorts             bool
	LBStrategy               string
	TenantID                 string
	CreatedByID              string
	CreatedAt                time.Time
	UpdatedAt                time.Time
	GatewayCount             int
}

const gatewayTemplateSelect = `
SELECT
	t.id,
	t.name,
	t.type::text,
	t.host,
	t.port,
	t."deploymentMode"::text,
	t.description,
	t."apiPort",
	t."autoScale",
	t."minReplicas",
	t."maxReplicas",
	t."sessionsPerInstance",
	t."scaleDownCooldownSeconds",
	t."monitoringEnabled",
	t."monitorIntervalMs",
	t."inactivityTimeoutSeconds",
	t."publishPorts",
	t."lbStrategy"::text,
	t."tenantId",
	t."createdById",
	t."createdAt",
	t."updatedAt",
	COALESCE(gateway_counts.count, 0) AS "gatewayCount"
FROM "GatewayTemplate" t
LEFT JOIN LATERAL (
	SELECT COUNT(*)::int AS count
	FROM "Gateway" g
	WHERE g."templateId" = t.id
) gateway_counts ON true
`

const insertGatewayTemplateSQL = `
INSERT INTO "GatewayTemplate" (
	id,
	name,
	type,
	host,
	port,
	"deploymentMode",
	description,
	"apiPort",
	"autoScale",
	"minReplicas",
	"maxReplicas",
	"sessionsPerInstance",
	"scaleDownCooldownSeconds",
	"monitoringEnabled",
	"monitorIntervalMs",
	"inactivityTimeoutSeconds",
	"publishPorts",
	"lbStrategy",
	"tenantId",
	"createdById",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1,
	$2,
	$3::"GatewayType",
	$4,
	$5,
	$6::"GatewayDeploymentMode",
	$7,
	$8,
	COALESCE($9, false),
	COALESCE($10, 1),
	COALESCE($11, 5),
	COALESCE($12, 10),
	COALESCE($13, 300),
	COALESCE($14, true),
	COALESCE($15, 5000),
	COALESCE($16, 3600),
	COALESCE($17, false),
	COALESCE($18::"LoadBalancingStrategy", 'ROUND_ROBIN'::"LoadBalancingStrategy"),
	$19,
	$20,
	NOW(),
	NOW()
)
`

const insertGatewayFromTemplateSQL = `
INSERT INTO "Gateway" (
	id,
	name,
	type,
	host,
	port,
	"deploymentMode",
	description,
	"apiPort",
	"isManaged",
	"desiredReplicas",
	"autoScale",
	"minReplicas",
	"maxReplicas",
	"sessionsPerInstance",
	"scaleDownCooldownSeconds",
	"monitoringEnabled",
	"monitorIntervalMs",
	"inactivityTimeoutSeconds",
	"publishPorts",
	"lbStrategy",
	"tenantId",
	"createdById",
	"templateId",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1,
	$2,
	$3::"GatewayType",
	$4,
	$5,
	$6::"GatewayDeploymentMode",
	$7,
	$8,
	$9,
	$10,
	$11,
	$12,
	$13,
	$14,
	$15,
	$16,
	$17,
	$18,
	$19::"LoadBalancingStrategy",
	$20,
	$21,
	$22,
	NOW(),
	NOW()
)
`

func (s Service) ListGatewayTemplates(ctx context.Context, tenantID string) ([]gatewayTemplateResponse, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}
	rows, err := s.DB.Query(ctx, gatewayTemplateSelect+`
WHERE t."tenantId" = $1
ORDER BY t.name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list gateway templates: %w", err)
	}
	defer rows.Close()

	result := make([]gatewayTemplateResponse, 0)
	for rows.Next() {
		record, err := scanGatewayTemplate(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, gatewayTemplateRecordToResponse(record))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate gateway templates: %w", err)
	}
	return result, nil
}

func (s Service) CreateGatewayTemplate(ctx context.Context, claims authn.Claims, input createTemplatePayload, ipAddress string) (gatewayTemplateResponse, error) {
	if s.DB == nil {
		return gatewayTemplateResponse{}, fmt.Errorf("database is unavailable")
	}
	normalized, err := normalizeCreateTemplatePayload(input)
	if err != nil {
		return gatewayTemplateResponse{}, err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("begin gateway template create transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	id := uuid.NewString()
	if _, err := tx.Exec(ctx, insertGatewayTemplateSQL, id, normalized.Name, normalized.Type, normalized.Host, normalized.Port, normalized.DeploymentMode, trimStringPtr(normalized.Description), normalized.APIPort, normalized.AutoScale, normalized.MinReplicas, normalized.MaxReplicas, normalized.SessionsPerInstance, normalized.ScaleDownCooldownSeconds, normalized.MonitoringEnabled, normalized.MonitorIntervalMS, normalized.InactivityTimeoutSeconds, normalized.PublishPorts, normalized.LBStrategy, claims.TenantID, claims.UserID); err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("insert gateway template: %w", err)
	}

	if err := s.insertTemplateAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_TEMPLATE_CREATE", id, map[string]any{
		"name": normalized.Name,
		"type": normalized.Type,
	}, ipAddress); err != nil {
		return gatewayTemplateResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("commit gateway template create transaction: %w", err)
	}

	record, err := s.loadGatewayTemplate(ctx, claims.TenantID, id)
	if err != nil {
		return gatewayTemplateResponse{}, err
	}
	return gatewayTemplateRecordToResponse(record), nil
}

func (s Service) UpdateGatewayTemplate(ctx context.Context, claims authn.Claims, templateID string, input updateTemplatePayload, ipAddress string) (gatewayTemplateResponse, error) {
	if s.DB == nil {
		return gatewayTemplateResponse{}, fmt.Errorf("database is unavailable")
	}
	record, err := s.loadGatewayTemplate(ctx, claims.TenantID, templateID)
	if err != nil {
		return gatewayTemplateResponse{}, err
	}
	if err := validateUpdateTemplatePayload(input); err != nil {
		return gatewayTemplateResponse{}, err
	}

	updatedName := strings.TrimSpace(chooseString(record.Name, input.Name))
	updatedType := chooseString(record.Type, input.Type)
	if input.Type.Present && input.Type.Value != nil {
		updatedType = strings.ToUpper(strings.TrimSpace(*input.Type.Value))
	}
	updatedHostInput := chooseString(record.Host, input.Host)
	deploymentModeInput := record.DeploymentMode
	if input.DeploymentMode.Present && input.DeploymentMode.Value != nil {
		deploymentModeInput = *input.DeploymentMode.Value
	}
	updatedDeploymentMode, err := normalizeDeploymentMode(&deploymentModeInput, updatedType, updatedHostInput)
	if err != nil {
		return gatewayTemplateResponse{}, err
	}
	updatedHost := normalizeGatewayHostForMode(updatedDeploymentMode, updatedHostInput)
	updatedPort := chooseInt(record.Port, input.Port)
	updatedDescription := chooseNullableString(record.Description, input.Description)
	updatedAPIPort := chooseNullableInt(record.APIPort, input.APIPort)
	updatedAutoScale := chooseBool(record.AutoScale, input.AutoScale)
	updatedMinReplicas := chooseInt(record.MinReplicas, input.MinReplicas)
	updatedMaxReplicas := chooseInt(record.MaxReplicas, input.MaxReplicas)
	updatedSessionsPerInstance := chooseInt(record.SessionsPerInstance, input.SessionsPerInstance)
	updatedScaleDownCooldown := chooseInt(record.ScaleDownCooldownSeconds, input.ScaleDownCooldownSeconds)
	updatedMonitoringEnabled := chooseBool(record.MonitoringEnabled, input.MonitoringEnabled)
	updatedMonitorInterval := chooseInt(record.MonitorIntervalMS, input.MonitorIntervalMS)
	updatedInactivityTimeout := chooseInt(record.InactivityTimeoutSeconds, input.InactivityTimeoutSeconds)
	updatedPublishPorts := chooseBool(record.PublishPorts, input.PublishPorts)
	updatedLBStrategy := chooseString(record.LBStrategy, input.LBStrategy)
	if normalized := normalizeLBStrategyPtr(input.LBStrategy.Value); normalized != nil {
		updatedLBStrategy = *normalized
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("begin gateway template update transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
UPDATE "GatewayTemplate"
   SET name = $2,
       type = $3::"GatewayType",
       host = $4,
       port = $5,
       "deploymentMode" = $6::"GatewayDeploymentMode",
       description = $7,
       "apiPort" = $8,
       "autoScale" = $9,
       "minReplicas" = $10,
       "maxReplicas" = $11,
       "sessionsPerInstance" = $12,
       "scaleDownCooldownSeconds" = $13,
       "monitoringEnabled" = $14,
       "monitorIntervalMs" = $15,
       "inactivityTimeoutSeconds" = $16,
       "publishPorts" = $17,
       "lbStrategy" = $18::"LoadBalancingStrategy",
       "updatedAt" = NOW()
 WHERE id = $1
`, templateID, updatedName, updatedType, updatedHost, updatedPort, updatedDeploymentMode, updatedDescription, updatedAPIPort, updatedAutoScale, updatedMinReplicas, updatedMaxReplicas, updatedSessionsPerInstance, updatedScaleDownCooldown, updatedMonitoringEnabled, updatedMonitorInterval, updatedInactivityTimeout, updatedPublishPorts, updatedLBStrategy); err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("update gateway template: %w", err)
	}

	if err := s.insertTemplateAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_TEMPLATE_UPDATE", templateID, changedTemplateDetails(input), ipAddress); err != nil {
		return gatewayTemplateResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return gatewayTemplateResponse{}, fmt.Errorf("commit gateway template update transaction: %w", err)
	}

	updated, err := s.loadGatewayTemplate(ctx, claims.TenantID, templateID)
	if err != nil {
		return gatewayTemplateResponse{}, err
	}
	return gatewayTemplateRecordToResponse(updated), nil
}

func (s Service) DeleteGatewayTemplate(ctx context.Context, claims authn.Claims, templateID, ipAddress string) (map[string]any, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}
	record, err := s.loadGatewayTemplate(ctx, claims.TenantID, templateID)
	if err != nil {
		return nil, err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin gateway template delete transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM "GatewayTemplate" WHERE id = $1`, templateID); err != nil {
		return nil, fmt.Errorf("delete gateway template: %w", err)
	}
	if err := s.insertTemplateAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_TEMPLATE_DELETE", templateID, map[string]any{"name": record.Name}, ipAddress); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit gateway template delete transaction: %w", err)
	}

	return map[string]any{"deleted": true}, nil
}

func (s Service) DeployGatewayTemplate(ctx context.Context, claims authn.Claims, templateID, ipAddress string) (gatewayResponse, error) {
	if s.DB == nil {
		return gatewayResponse{}, fmt.Errorf("database is unavailable")
	}

	template, err := s.loadGatewayTemplate(ctx, claims.TenantID, templateID)
	if err != nil {
		return gatewayResponse{}, err
	}
	if strings.EqualFold(template.Type, "MANAGED_SSH") {
		var exists bool
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "SshKeyPair" WHERE "tenantId" = $1)`, claims.TenantID).Scan(&exists); err != nil {
			return gatewayResponse{}, fmt.Errorf("check ssh key pair: %w", err)
		}
		if !exists {
			return gatewayResponse{}, &requestError{status: http.StatusBadRequest, message: "SSH key pair not found for this tenant. Generate one first."}
		}
	}

	id := uuid.NewString()
	name := buildTemplateDeploymentName(claims.TenantID, template.Name)
	deploymentMode := template.DeploymentMode
	if strings.TrimSpace(deploymentMode) == "" {
		deploymentMode = "SINGLE_INSTANCE"
	}
	host := normalizeGatewayHostForMode(deploymentMode, template.Host)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayResponse{}, fmt.Errorf("begin template deploy transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	desiredReplicas := 0
	if deploymentModeIsGroup(deploymentMode) {
		desiredReplicas = 1
	}
	if _, err := tx.Exec(ctx, insertGatewayFromTemplateSQL, id, name, template.Type, host, template.Port, deploymentMode, trimStringPtr(template.Description), template.APIPort, deploymentModeIsGroup(deploymentMode), desiredReplicas, template.AutoScale, template.MinReplicas, template.MaxReplicas, template.SessionsPerInstance, template.ScaleDownCooldownSeconds, template.MonitoringEnabled, template.MonitorIntervalMS, template.InactivityTimeoutSeconds, template.PublishPorts, template.LBStrategy, claims.TenantID, claims.UserID, templateID); err != nil {
		return gatewayResponse{}, fmt.Errorf("insert gateway from template: %w", err)
	}

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_TEMPLATE_DEPLOY", templateID, map[string]any{
		"gatewayId":   id,
		"gatewayName": name,
	}, ipAddress); err != nil {
		return gatewayResponse{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return gatewayResponse{}, fmt.Errorf("commit template deploy transaction: %w", err)
	}

	record, err := s.loadGateway(ctx, claims.TenantID, id)
	if err != nil {
		return gatewayResponse{}, err
	}
	if deploymentModeIsGroup(deploymentMode) {
		if _, err := s.DeployGatewayInstance(ctx, claims, id); err != nil {
			return gatewayResponse{}, err
		}
	}
	record, err = s.loadGateway(ctx, claims.TenantID, id)
	if err != nil {
		return gatewayResponse{}, err
	}
	return gatewayRecordToResponse(record), nil
}

func (s Service) loadGatewayTemplate(ctx context.Context, tenantID, templateID string) (gatewayTemplateRecord, error) {
	row := s.DB.QueryRow(ctx, gatewayTemplateSelect+`
WHERE t."tenantId" = $1 AND t.id = $2
`, tenantID, templateID)
	record, err := scanGatewayTemplate(row)
	if err != nil {
		return gatewayTemplateRecord{}, err
	}
	return record, nil
}

func scanGatewayTemplate(row rowScanner) (gatewayTemplateRecord, error) {
	var (
		item        gatewayTemplateRecord
		description sql.NullString
		apiPort     sql.NullInt32
	)
	if err := row.Scan(
		&item.ID,
		&item.Name,
		&item.Type,
		&item.Host,
		&item.Port,
		&item.DeploymentMode,
		&description,
		&apiPort,
		&item.AutoScale,
		&item.MinReplicas,
		&item.MaxReplicas,
		&item.SessionsPerInstance,
		&item.ScaleDownCooldownSeconds,
		&item.MonitoringEnabled,
		&item.MonitorIntervalMS,
		&item.InactivityTimeoutSeconds,
		&item.PublishPorts,
		&item.LBStrategy,
		&item.TenantID,
		&item.CreatedByID,
		&item.CreatedAt,
		&item.UpdatedAt,
		&item.GatewayCount,
	); err != nil {
		if err == pgx.ErrNoRows {
			return gatewayTemplateRecord{}, &requestError{status: http.StatusNotFound, message: "Gateway template not found"}
		}
		return gatewayTemplateRecord{}, fmt.Errorf("scan gateway template: %w", err)
	}
	item.Description = nullStringPtr(description)
	item.APIPort = nullIntPtr(apiPort)
	if strings.TrimSpace(item.DeploymentMode) == "" {
		mode, err := normalizeDeploymentMode(nil, item.Type, item.Host)
		if err == nil {
			item.DeploymentMode = mode
		}
	}
	return item, nil
}

func gatewayTemplateRecordToResponse(item gatewayTemplateRecord) gatewayTemplateResponse {
	deploymentMode := item.DeploymentMode
	if strings.TrimSpace(deploymentMode) == "" {
		mode, err := normalizeDeploymentMode(nil, item.Type, item.Host)
		if err == nil {
			deploymentMode = mode
		}
	}
	return gatewayTemplateResponse{
		ID:                       item.ID,
		Name:                     item.Name,
		Type:                     item.Type,
		Host:                     item.Host,
		Port:                     item.Port,
		DeploymentMode:           deploymentMode,
		Description:              item.Description,
		APIPort:                  item.APIPort,
		AutoScale:                item.AutoScale,
		MinReplicas:              item.MinReplicas,
		MaxReplicas:              item.MaxReplicas,
		SessionsPerInstance:      item.SessionsPerInstance,
		ScaleDownCooldownSeconds: item.ScaleDownCooldownSeconds,
		MonitoringEnabled:        item.MonitoringEnabled,
		MonitorIntervalMS:        item.MonitorIntervalMS,
		InactivityTimeoutSeconds: item.InactivityTimeoutSeconds,
		PublishPorts:             item.PublishPorts,
		LBStrategy:               item.LBStrategy,
		TenantID:                 item.TenantID,
		CreatedByID:              item.CreatedByID,
		CreatedAt:                item.CreatedAt,
		UpdatedAt:                item.UpdatedAt,
		Count:                    gatewayTemplateCount{Gateways: item.GatewayCount},
	}
}

func (s Service) insertTemplateAuditLogTx(ctx context.Context, tx pgx.Tx, userID, action, targetID string, details map[string]any, ipAddress string) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal gateway template audit details: %w", err)
	}
	_, err = tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress", "createdAt")
VALUES ($1, $2, $3::"AuditAction", 'GatewayTemplate', $4, $5::jsonb, NULLIF($6, ''), NOW())
`, uuid.NewString(), userID, action, targetID, string(payload), ipAddress)
	if err != nil {
		return fmt.Errorf("insert gateway template audit log: %w", err)
	}
	return nil
}

func normalizeCreateTemplatePayload(input createTemplatePayload) (normalizedCreateTemplatePayload, error) {
	name := strings.TrimSpace(input.Name)
	if name == "" {
		return normalizedCreateTemplatePayload{}, &requestError{status: http.StatusBadRequest, message: "name is required"}
	}
	if len(name) > 100 {
		return normalizedCreateTemplatePayload{}, &requestError{status: http.StatusBadRequest, message: "name must be 100 characters or fewer"}
	}

	gatewayType := strings.ToUpper(strings.TrimSpace(input.Type))
	if !isAllowedGatewayType(gatewayType) {
		return normalizedCreateTemplatePayload{}, &requestError{status: http.StatusBadRequest, message: "type must be one of GUACD, SSH_BASTION, MANAGED_SSH, DB_PROXY"}
	}

	host := ""
	if input.Host != nil {
		host = strings.TrimSpace(*input.Host)
	}
	deploymentMode, err := normalizeDeploymentMode(input.DeploymentMode, gatewayType, host)
	if err != nil {
		return normalizedCreateTemplatePayload{}, err
	}

	port := 0
	if input.Port != nil {
		port = *input.Port
	}

	if deploymentModeIsGroup(deploymentMode) && port == 0 {
		switch gatewayType {
		case "MANAGED_SSH":
			port = 2222
		case "GUACD":
			port = 4822
		case "DB_PROXY":
			port = 5432
		}
	}
	if gatewayType == "SSH_BASTION" && port == 0 {
		return normalizedCreateTemplatePayload{}, &requestError{status: http.StatusBadRequest, message: "port is required for SSH_BASTION templates"}
	}

	normalized := normalizedCreateTemplatePayload{
		Name:                     name,
		Type:                     gatewayType,
		Host:                     normalizeGatewayHostForMode(deploymentMode, host),
		Port:                     port,
		DeploymentMode:           deploymentMode,
		Description:              trimStringPtr(input.Description),
		APIPort:                  input.APIPort,
		AutoScale:                input.AutoScale,
		MinReplicas:              input.MinReplicas,
		MaxReplicas:              input.MaxReplicas,
		SessionsPerInstance:      input.SessionsPerInstance,
		ScaleDownCooldownSeconds: input.ScaleDownCooldownSeconds,
		MonitoringEnabled:        input.MonitoringEnabled,
		MonitorIntervalMS:        input.MonitorIntervalMS,
		InactivityTimeoutSeconds: input.InactivityTimeoutSeconds,
		PublishPorts:             input.PublishPorts,
		LBStrategy:               normalizeLBStrategyPtr(input.LBStrategy),
	}
	if err := validateNormalizedCreateTemplatePayload(normalized); err != nil {
		return normalizedCreateTemplatePayload{}, err
	}
	return normalized, nil
}

func validateNormalizedCreateTemplatePayload(input normalizedCreateTemplatePayload) error {
	if input.Port < 1 || input.Port > 65535 {
		return &requestError{status: http.StatusBadRequest, message: "port must be between 1 and 65535"}
	}
	return validateTemplateConstraints(
		input.Description,
		input.APIPort,
		input.MinReplicas,
		input.MaxReplicas,
		input.SessionsPerInstance,
		input.ScaleDownCooldownSeconds,
		input.MonitorIntervalMS,
		input.InactivityTimeoutSeconds,
		input.LBStrategy,
	)
}

func validateUpdateTemplatePayload(input updateTemplatePayload) error {
	if input.Name.Present && input.Name.Value != nil {
		name := strings.TrimSpace(*input.Name.Value)
		if name == "" {
			return &requestError{status: http.StatusBadRequest, message: "name cannot be empty"}
		}
		if len(name) > 100 {
			return &requestError{status: http.StatusBadRequest, message: "name must be 100 characters or fewer"}
		}
	}
	if input.Type.Present && input.Type.Value != nil && !isAllowedGatewayType(strings.ToUpper(strings.TrimSpace(*input.Type.Value))) {
		return &requestError{status: http.StatusBadRequest, message: "type must be one of GUACD, SSH_BASTION, MANAGED_SSH, DB_PROXY"}
	}
	if input.DeploymentMode.Present && input.DeploymentMode.Value != nil {
		switch strings.ToUpper(strings.TrimSpace(*input.DeploymentMode.Value)) {
		case "SINGLE_INSTANCE", "MANAGED_GROUP":
		default:
			return &requestError{status: http.StatusBadRequest, message: "deploymentMode must be SINGLE_INSTANCE or MANAGED_GROUP"}
		}
	}
	return validateTemplateConstraints(
		input.Description.Value,
		input.APIPort.Value,
		input.MinReplicas.Value,
		input.MaxReplicas.Value,
		input.SessionsPerInstance.Value,
		input.ScaleDownCooldownSeconds.Value,
		input.MonitorIntervalMS.Value,
		input.InactivityTimeoutSeconds.Value,
		normalizeLBStrategyPtr(input.LBStrategy.Value),
	)
}

func validateTemplateConstraints(description *string, apiPort, minReplicas, maxReplicas, sessionsPerInstance, scaleDownCooldownSeconds, monitorIntervalMS, inactivityTimeoutSeconds *int, lbStrategy *string) error {
	if description != nil && len(*description) > 500 {
		return &requestError{status: http.StatusBadRequest, message: "description must be 500 characters or fewer"}
	}
	if apiPort != nil && (*apiPort < 1 || *apiPort > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "apiPort must be between 1 and 65535"}
	}
	if minReplicas != nil && (*minReplicas < 0 || *minReplicas > 20) {
		return &requestError{status: http.StatusBadRequest, message: "minReplicas must be between 0 and 20"}
	}
	if maxReplicas != nil && (*maxReplicas < 1 || *maxReplicas > 20) {
		return &requestError{status: http.StatusBadRequest, message: "maxReplicas must be between 1 and 20"}
	}
	if minReplicas != nil && maxReplicas != nil && *minReplicas > *maxReplicas {
		return &requestError{status: http.StatusBadRequest, message: "minReplicas must be less than or equal to maxReplicas"}
	}
	if sessionsPerInstance != nil && (*sessionsPerInstance < 1 || *sessionsPerInstance > 100) {
		return &requestError{status: http.StatusBadRequest, message: "sessionsPerInstance must be between 1 and 100"}
	}
	if scaleDownCooldownSeconds != nil && (*scaleDownCooldownSeconds < 60 || *scaleDownCooldownSeconds > 3600) {
		return &requestError{status: http.StatusBadRequest, message: "scaleDownCooldownSeconds must be between 60 and 3600"}
	}
	if monitorIntervalMS != nil && (*monitorIntervalMS < 1000 || *monitorIntervalMS > 3600000) {
		return &requestError{status: http.StatusBadRequest, message: "monitorIntervalMs must be between 1000 and 3600000"}
	}
	if inactivityTimeoutSeconds != nil && (*inactivityTimeoutSeconds < 60 || *inactivityTimeoutSeconds > 86400) {
		return &requestError{status: http.StatusBadRequest, message: "inactivityTimeoutSeconds must be between 60 and 86400"}
	}
	if lbStrategy != nil && !isAllowedLBStrategy(*lbStrategy) {
		return &requestError{status: http.StatusBadRequest, message: "lbStrategy must be ROUND_ROBIN or LEAST_CONNECTIONS"}
	}
	return nil
}

func changedTemplateDetails(input updateTemplatePayload) map[string]any {
	details := map[string]any{}
	if input.Name.Present {
		details["name"] = input.Name.Value
	}
	if input.Type.Present {
		if input.Type.Value == nil {
			details["type"] = nil
		} else {
			value := strings.ToUpper(strings.TrimSpace(*input.Type.Value))
			details["type"] = value
		}
	}
	if input.Host.Present {
		details["host"] = input.Host.Value
	}
	if input.Port.Present {
		details["port"] = input.Port.Value
	}
	if input.DeploymentMode.Present {
		if input.DeploymentMode.Value == nil {
			details["deploymentMode"] = nil
		} else {
			details["deploymentMode"] = strings.ToUpper(strings.TrimSpace(*input.DeploymentMode.Value))
		}
	}
	if input.Description.Present {
		details["description"] = input.Description.Value
	}
	if input.APIPort.Present {
		details["apiPort"] = input.APIPort.Value
	}
	if input.AutoScale.Present {
		details["autoScale"] = input.AutoScale.Value
	}
	if input.MinReplicas.Present {
		details["minReplicas"] = input.MinReplicas.Value
	}
	if input.MaxReplicas.Present {
		details["maxReplicas"] = input.MaxReplicas.Value
	}
	if input.SessionsPerInstance.Present {
		details["sessionsPerInstance"] = input.SessionsPerInstance.Value
	}
	if input.ScaleDownCooldownSeconds.Present {
		details["scaleDownCooldownSeconds"] = input.ScaleDownCooldownSeconds.Value
	}
	if input.MonitoringEnabled.Present {
		details["monitoringEnabled"] = input.MonitoringEnabled.Value
	}
	if input.MonitorIntervalMS.Present {
		details["monitorIntervalMs"] = input.MonitorIntervalMS.Value
	}
	if input.InactivityTimeoutSeconds.Present {
		details["inactivityTimeoutSeconds"] = input.InactivityTimeoutSeconds.Value
	}
	if input.PublishPorts.Present {
		details["publishPorts"] = input.PublishPorts.Value
	}
	if input.LBStrategy.Present {
		details["lbStrategy"] = normalizeLBStrategyPtr(input.LBStrategy.Value)
	}
	return details
}

func normalizeLBStrategyPtr(value *string) *string {
	if value == nil {
		return nil
	}
	normalized := strings.ToUpper(strings.TrimSpace(*value))
	if normalized == "" {
		return nil
	}
	return &normalized
}

func isAllowedGatewayType(gatewayType string) bool {
	switch gatewayType {
	case "GUACD", "SSH_BASTION", "MANAGED_SSH", "DB_PROXY":
		return true
	default:
		return false
	}
}

func isManagedGatewayType(gatewayType string) bool {
	switch gatewayType {
	case "MANAGED_SSH", "GUACD", "DB_PROXY":
		return true
	default:
		return false
	}
}

func buildTemplateDeploymentName(tenantID, templateName string) string {
	prefix := strings.TrimSpace(tenantID)
	if len(prefix) > 8 {
		prefix = prefix[:8]
	}
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")
	if len(suffix) > 6 {
		suffix = suffix[:6]
	}
	return fmt.Sprintf("%s-%s-%s", prefix, strings.TrimSpace(templateName), suffix)
}

func isAllowedLBStrategy(strategy string) bool {
	switch strategy {
	case "ROUND_ROBIN", "LEAST_CONNECTIONS":
		return true
	default:
		return false
	}
}
