package gateways

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
)

func (s Service) CreateGateway(ctx context.Context, claims authn.Claims, input createPayload, ipAddress string) (gatewayResponse, error) {
	if s.DB == nil {
		return gatewayResponse{}, fmt.Errorf("database is unavailable")
	}
	if err := validateCreatePayload(input); err != nil {
		return gatewayResponse{}, err
	}
	deploymentMode, err := normalizeDeploymentMode(input.DeploymentMode, input.Type, input.Host)
	if err != nil {
		return gatewayResponse{}, err
	}
	normalizedHost := normalizeGatewayHostForMode(deploymentMode, input.Host)
	egressPolicy, err := prepareGatewayEgressPolicy(input.EgressPolicy)
	if err != nil {
		return gatewayResponse{}, err
	}

	enc, err := s.prepareCredentialFields(ctx, claims.UserID, strings.TrimSpace(input.Type), input.Username, input.Password, input.SSHPrivateKey)
	if err != nil {
		return gatewayResponse{}, err
	}
	usernameCipher, usernameIV, usernameTag := encryptedFieldParts(enc.username)
	passwordCipher, passwordIV, passwordTag := encryptedFieldParts(enc.password)
	sshKeyCipher, sshKeyIV, sshKeyTag := encryptedFieldParts(enc.sshKey)

	if strings.EqualFold(strings.TrimSpace(input.Type), "MANAGED_SSH") {
		var exists bool
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "SshKeyPair" WHERE "tenantId" = $1)`, claims.TenantID).Scan(&exists); err != nil {
			return gatewayResponse{}, fmt.Errorf("check ssh key pair: %w", err)
		}
		if !exists {
			return gatewayResponse{}, &requestError{status: http.StatusBadRequest, message: "Cannot create MANAGED_SSH gateway: no SSH key pair generated for this tenant. Generate one first."}
		}
	}

	id := uuid.NewString()
	isDefault := boolValue(input.IsDefault, false)
	apiPort := input.APIPort
	if strings.EqualFold(strings.TrimSpace(input.Type), "MANAGED_SSH") && apiPort == nil && s.DefaultGRPCPort > 0 {
		apiPort = intPtr(s.DefaultGRPCPort)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayResponse{}, fmt.Errorf("begin gateway create transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if isDefault {
		if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "isDefault" = false,
       "updatedAt" = NOW()
 WHERE "tenantId" = $1
   AND type = $2::"GatewayType"
   AND "isDefault" = true
`, claims.TenantID, strings.ToUpper(strings.TrimSpace(input.Type))); err != nil {
			return gatewayResponse{}, fmt.Errorf("clear default gateways: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO "Gateway" (
  id, name, type, host, port, description, "isDefault", "tenantId", "createdById",
  "deploymentMode",
  "encryptedUsername", "usernameIV", "usernameTag",
  "encryptedPassword", "passwordIV", "passwordTag",
  "encryptedSshKey", "sshKeyIV", "sshKeyTag",
  "apiPort", "monitoringEnabled", "monitorIntervalMs", "inactivityTimeoutSeconds",
  "isManaged", "publishPorts", "lbStrategy", "egressPolicy", "createdAt", "updatedAt"
) VALUES (
  $1, $2, $3::"GatewayType", $4, $5, $6, $7, $8, $9,
  $10::"GatewayDeploymentMode",
  $11, $12, $13,
  $14, $15, $16,
  $17, $18, $19,
  $20, $21, $22, $23,
  $24, $25, $26::"LoadBalancingStrategy", $27::jsonb, NOW(), NOW()
)
`,
		id,
		strings.TrimSpace(input.Name),
		strings.ToUpper(strings.TrimSpace(input.Type)),
		normalizedHost,
		input.Port,
		trimStringPtr(input.Description),
		isDefault,
		claims.TenantID,
		claims.UserID,
		deploymentMode,
		usernameCipher,
		usernameIV,
		usernameTag,
		passwordCipher,
		passwordIV,
		passwordTag,
		sshKeyCipher,
		sshKeyIV,
		sshKeyTag,
		apiPort,
		boolValue(input.MonitoringEnabled, true),
		intValue(input.MonitorIntervalMS, 5000),
		intValue(input.InactivityTimeoutSeconds, 3600),
		deploymentModeIsGroup(deploymentMode),
		boolValue(input.PublishPorts, false),
		stringValue(input.LBStrategy, "ROUND_ROBIN"),
		string(egressPolicy),
	); err != nil {
		return gatewayResponse{}, fmt.Errorf("insert gateway: %w", err)
	}

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_CREATE", id, map[string]any{
		"name":      strings.TrimSpace(input.Name),
		"type":      strings.ToUpper(strings.TrimSpace(input.Type)),
		"isDefault": isDefault,
	}, ipAddress); err != nil {
		return gatewayResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return gatewayResponse{}, fmt.Errorf("commit gateway create transaction: %w", err)
	}

	record, err := s.loadGateway(ctx, claims.TenantID, id)
	if err != nil {
		return gatewayResponse{}, err
	}
	return gatewayRecordToResponse(record), nil
}

func (s Service) UpdateGateway(ctx context.Context, claims authn.Claims, gatewayID string, input updatePayload, ipAddress string) (gatewayResponse, error) {
	if s.DB == nil {
		return gatewayResponse{}, fmt.Errorf("database is unavailable")
	}
	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return gatewayResponse{}, err
	}
	if err := validateUpdatePayload(record.Type, input); err != nil {
		return gatewayResponse{}, err
	}
	updatedHostInput := record.Host
	if input.Host.Present && input.Host.Value != nil {
		updatedHostInput = *input.Host.Value
	}
	deploymentModeInput := record.DeploymentMode
	if input.DeploymentMode.Present && input.DeploymentMode.Value != nil {
		deploymentModeInput = *input.DeploymentMode.Value
	}
	deploymentMode, err := normalizeDeploymentMode(&deploymentModeInput, record.Type, updatedHostInput)
	if err != nil {
		return gatewayResponse{}, err
	}

	if strings.EqualFold(record.Type, "MANAGED_SSH") && input.APIPort.Present && input.APIPort.Value == nil {
		return gatewayResponse{}, &requestError{status: http.StatusBadRequest, message: "apiPort cannot be null for MANAGED_SSH gateways"}
	}

	enc, err := s.mergeCredentialFields(ctx, claims.UserID, record, input)
	if err != nil {
		return gatewayResponse{}, err
	}
	usernameCipher, usernameIV, usernameTag := encryptedFieldParts(enc.username)
	passwordCipher, passwordIV, passwordTag := encryptedFieldParts(enc.password)
	sshKeyCipher, sshKeyIV, sshKeyTag := encryptedFieldParts(enc.sshKey)

	updatedName := chooseString(record.Name, input.Name)
	updatedHost := normalizeGatewayHostForMode(deploymentMode, chooseString(record.Host, input.Host))
	updatedPort := chooseInt(record.Port, input.Port)
	updatedDescription := chooseNullableString(record.Description, input.Description)
	updatedDefault := chooseBool(record.IsDefault, input.IsDefault)
	updatedAPIPort := chooseNullableInt(record.APIPort, input.APIPort)
	updatedMonitoringEnabled := chooseBool(record.MonitoringEnabled, input.MonitoringEnabled)
	updatedMonitorInterval := chooseInt(record.MonitorIntervalMS, input.MonitorIntervalMS)
	updatedInactivity := chooseInt(record.InactivityTimeoutSeconds, input.InactivityTimeoutSeconds)
	updatedPublishPorts := chooseBool(record.PublishPorts, input.PublishPorts)
	updatedLB := chooseString(record.LBStrategy, input.LBStrategy)
	updatedEgressPolicy, err := chooseGatewayEgressPolicy(record.EgressPolicy, input.EgressPolicy)
	if err != nil {
		return gatewayResponse{}, err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayResponse{}, fmt.Errorf("begin gateway update transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if updatedDefault && !record.IsDefault {
		if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "isDefault" = false,
       "updatedAt" = NOW()
 WHERE "tenantId" = $1
   AND type = $2::"GatewayType"
   AND id <> $3
   AND "isDefault" = true
`, claims.TenantID, record.Type, record.ID); err != nil {
			return gatewayResponse{}, fmt.Errorf("clear default gateways: %w", err)
		}
	}

	if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET name = $2,
       host = $3,
       port = $4,
       "deploymentMode" = $5::"GatewayDeploymentMode",
       description = $6,
       "isDefault" = $7,
       "encryptedUsername" = $8,
       "usernameIV" = $9,
       "usernameTag" = $10,
       "encryptedPassword" = $11,
       "passwordIV" = $12,
       "passwordTag" = $13,
       "encryptedSshKey" = $14,
       "sshKeyIV" = $15,
       "sshKeyTag" = $16,
       "apiPort" = $17,
       "monitoringEnabled" = $18,
       "monitorIntervalMs" = $19,
       "inactivityTimeoutSeconds" = $20,
       "isManaged" = $21,
       "publishPorts" = $22,
       "lbStrategy" = $23::"LoadBalancingStrategy",
       "egressPolicy" = $24::jsonb,
       "updatedAt" = NOW()
 WHERE id = $1
`, record.ID,
		updatedName,
		updatedHost,
		updatedPort,
		deploymentMode,
		updatedDescription,
		updatedDefault,
		usernameCipher,
		usernameIV,
		usernameTag,
		passwordCipher,
		passwordIV,
		passwordTag,
		sshKeyCipher,
		sshKeyIV,
		sshKeyTag,
		updatedAPIPort,
		updatedMonitoringEnabled,
		updatedMonitorInterval,
		updatedInactivity,
		deploymentModeIsGroup(deploymentMode),
		updatedPublishPorts,
		updatedLB,
		string(updatedEgressPolicy),
	); err != nil {
		return gatewayResponse{}, fmt.Errorf("update gateway: %w", err)
	}

	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_UPDATE", record.ID, map[string]any{
		"fields": changedGatewayFields(input),
	}, ipAddress); err != nil {
		return gatewayResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return gatewayResponse{}, fmt.Errorf("commit gateway update transaction: %w", err)
	}

	updated, err := s.loadGateway(ctx, claims.TenantID, record.ID)
	if err != nil {
		return gatewayResponse{}, err
	}
	return gatewayRecordToResponse(updated), nil
}

func (s Service) DeleteGateway(ctx context.Context, claims authn.Claims, gatewayID string, force bool, ipAddress string) (map[string]any, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}
	record, err := s.loadGateway(ctx, claims.TenantID, gatewayID)
	if err != nil {
		return nil, err
	}

	var connectionCount int
	if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "Connection" WHERE "gatewayId" = $1`, gatewayID).Scan(&connectionCount); err != nil {
		return nil, fmt.Errorf("count gateway connections: %w", err)
	}
	if connectionCount > 0 && !force {
		return map[string]any{
			"blocked":         true,
			"connectionCount": connectionCount,
		}, nil
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin gateway delete transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM "Gateway" WHERE id = $1`, gatewayID); err != nil {
		return nil, fmt.Errorf("delete gateway: %w", err)
	}
	if err := s.insertAuditLogTx(ctx, tx, claims.UserID, "GATEWAY_DELETE", gatewayID, map[string]any{
		"force":                   force,
		"connectionCount":         connectionCount,
		"disconnectedConnections": connectionCount,
		"name":                    record.Name,
	}, ipAddress); err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit gateway delete transaction: %w", err)
	}

	return map[string]any{
		"deleted":         true,
		"connectionCount": connectionCount,
	}, nil
}
