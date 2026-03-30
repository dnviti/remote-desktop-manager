package gateways

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) CreateGateway(ctx context.Context, claims authn.Claims, input createPayload, ipAddress string) (gatewayResponse, error) {
	if s.DB == nil {
		return gatewayResponse{}, fmt.Errorf("database is unavailable")
	}
	if err := validateCreatePayload(input); err != nil {
		return gatewayResponse{}, err
	}

	enc, err := s.prepareCredentialFields(ctx, claims.UserID, strings.TrimSpace(input.Type), input.Username, input.Password, input.SSHPrivateKey)
	if err != nil {
		return gatewayResponse{}, err
	}

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
   SET "isDefault" = false
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
  "encryptedUsername", "usernameIV", "usernameTag",
  "encryptedPassword", "passwordIV", "passwordTag",
  "encryptedSshKey", "sshKeyIV", "sshKeyTag",
  "apiPort", "monitoringEnabled", "monitorIntervalMs", "inactivityTimeoutSeconds",
  "publishPorts", "lbStrategy"
) VALUES (
  $1, $2, $3::"GatewayType", $4, $5, $6, $7, $8, $9,
  $10, $11, $12,
  $13, $14, $15,
  $16, $17, $18,
  $19, $20, $21, $22,
  $23, $24::"LoadBalancingStrategy"
)
`,
		id,
		strings.TrimSpace(input.Name),
		strings.ToUpper(strings.TrimSpace(input.Type)),
		strings.TrimSpace(input.Host),
		input.Port,
		trimStringPtr(input.Description),
		isDefault,
		claims.TenantID,
		claims.UserID,
		enc.username.Ciphertext,
		enc.username.IV,
		enc.username.Tag,
		enc.password.Ciphertext,
		enc.password.IV,
		enc.password.Tag,
		enc.sshKey.Ciphertext,
		enc.sshKey.IV,
		enc.sshKey.Tag,
		apiPort,
		boolValue(input.MonitoringEnabled, true),
		intValue(input.MonitorIntervalMS, 5000),
		intValue(input.InactivityTimeoutSeconds, 3600),
		boolValue(input.PublishPorts, false),
		stringValue(input.LBStrategy, "ROUND_ROBIN"),
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

	if strings.EqualFold(record.Type, "MANAGED_SSH") && input.APIPort.Present && input.APIPort.Value == nil {
		return gatewayResponse{}, &requestError{status: http.StatusBadRequest, message: "apiPort cannot be null for MANAGED_SSH gateways"}
	}

	enc, err := s.mergeCredentialFields(ctx, claims.UserID, record, input)
	if err != nil {
		return gatewayResponse{}, err
	}

	updatedName := chooseString(record.Name, input.Name)
	updatedHost := chooseString(record.Host, input.Host)
	updatedPort := chooseInt(record.Port, input.Port)
	updatedDescription := chooseNullableString(record.Description, input.Description)
	updatedDefault := chooseBool(record.IsDefault, input.IsDefault)
	updatedAPIPort := chooseNullableInt(record.APIPort, input.APIPort)
	updatedMonitoringEnabled := chooseBool(record.MonitoringEnabled, input.MonitoringEnabled)
	updatedMonitorInterval := chooseInt(record.MonitorIntervalMS, input.MonitorIntervalMS)
	updatedInactivity := chooseInt(record.InactivityTimeoutSeconds, input.InactivityTimeoutSeconds)
	updatedPublishPorts := chooseBool(record.PublishPorts, input.PublishPorts)
	updatedLB := chooseString(record.LBStrategy, input.LBStrategy)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return gatewayResponse{}, fmt.Errorf("begin gateway update transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if updatedDefault && !record.IsDefault {
		if _, err := tx.Exec(ctx, `
UPDATE "Gateway"
   SET "isDefault" = false
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
       description = $5,
       "isDefault" = $6,
       "encryptedUsername" = $7,
       "usernameIV" = $8,
       "usernameTag" = $9,
       "encryptedPassword" = $10,
       "passwordIV" = $11,
       "passwordTag" = $12,
       "encryptedSshKey" = $13,
       "sshKeyIV" = $14,
       "sshKeyTag" = $15,
       "apiPort" = $16,
       "monitoringEnabled" = $17,
       "monitorIntervalMs" = $18,
       "inactivityTimeoutSeconds" = $19,
       "publishPorts" = $20,
       "lbStrategy" = $21::"LoadBalancingStrategy",
       "updatedAt" = NOW()
 WHERE id = $1
`, record.ID,
		updatedName,
		updatedHost,
		updatedPort,
		updatedDescription,
		updatedDefault,
		enc.username.Ciphertext,
		enc.username.IV,
		enc.username.Tag,
		enc.password.Ciphertext,
		enc.password.IV,
		enc.password.Tag,
		enc.sshKey.Ciphertext,
		enc.sshKey.IV,
		enc.sshKey.Tag,
		updatedAPIPort,
		updatedMonitoringEnabled,
		updatedMonitorInterval,
		updatedInactivity,
		updatedPublishPorts,
		updatedLB,
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

type credentialFields struct {
	username *encryptedField
	password *encryptedField
	sshKey   *encryptedField
}

func (s Service) prepareCredentialFields(ctx context.Context, userID, gatewayType string, username, password, sshPrivateKey *string) (credentialFields, error) {
	gatewayType = strings.ToUpper(strings.TrimSpace(gatewayType))
	if gatewayType != "SSH_BASTION" {
		if hasText(username) || hasText(password) || hasText(sshPrivateKey) {
			switch gatewayType {
			case "MANAGED_SSH":
				return credentialFields{}, &requestError{status: http.StatusBadRequest, message: "MANAGED_SSH gateways use the server-managed key pair. Do not supply credentials."}
			case "DB_PROXY":
				return credentialFields{}, &requestError{status: http.StatusBadRequest, message: "DB_PROXY gateways do not use direct credentials. Credentials are injected per-session from the vault."}
			default:
				return credentialFields{}, &requestError{status: http.StatusBadRequest, message: "Credentials can only be set for SSH_BASTION gateways"}
			}
		}
		return credentialFields{}, nil
	}
	if !hasText(username) && !hasText(password) && !hasText(sshPrivateKey) {
		return credentialFields{}, nil
	}
	masterKey, err := s.getVaultKey(ctx, userID)
	if err != nil {
		return credentialFields{}, err
	}
	if len(masterKey) == 0 {
		return credentialFields{}, &requestError{status: http.StatusForbidden, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(masterKey)

	var result credentialFields
	if hasText(username) {
		field, err := encryptValue(masterKey, strings.TrimSpace(*username))
		if err != nil {
			return credentialFields{}, err
		}
		result.username = &field
	}
	if hasText(password) {
		field, err := encryptValue(masterKey, *password)
		if err != nil {
			return credentialFields{}, err
		}
		result.password = &field
	}
	if hasText(sshPrivateKey) {
		field, err := encryptValue(masterKey, *sshPrivateKey)
		if err != nil {
			return credentialFields{}, err
		}
		result.sshKey = &field
	}
	return result, nil
}

func (s Service) mergeCredentialFields(ctx context.Context, userID string, record gatewayRecord, input updatePayload) (credentialFields, error) {
	result := credentialFields{
		username: encryptedFieldFromRecord(record.EncryptedUsername, record.UsernameIV, record.UsernameTag),
		password: encryptedFieldFromRecord(record.EncryptedPassword, record.PasswordIV, record.PasswordTag),
		sshKey:   encryptedFieldFromRecord(record.EncryptedSSHKey, record.SSHKeyIV, record.SSHKeyTag),
	}
	if record.Type != "SSH_BASTION" {
		if input.Username.Present || input.Password.Present || input.SSHPrivateKey.Present {
			return credentialFields{}, &requestError{status: http.StatusBadRequest, message: "Credentials can only be set for SSH_BASTION gateways"}
		}
		return result, nil
	}
	if !input.Username.Present && !input.Password.Present && !input.SSHPrivateKey.Present {
		return result, nil
	}
	masterKey, err := s.getVaultKey(ctx, userID)
	if err != nil {
		return credentialFields{}, err
	}
	if len(masterKey) == 0 {
		return credentialFields{}, &requestError{status: http.StatusForbidden, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(masterKey)

	if input.Username.Present {
		if input.Username.Value == nil {
			result.username = nil
		} else {
			field, err := encryptValue(masterKey, strings.TrimSpace(*input.Username.Value))
			if err != nil {
				return credentialFields{}, err
			}
			result.username = &field
		}
	}
	if input.Password.Present {
		if input.Password.Value == nil {
			result.password = nil
		} else {
			field, err := encryptValue(masterKey, *input.Password.Value)
			if err != nil {
				return credentialFields{}, err
			}
			result.password = &field
		}
	}
	if input.SSHPrivateKey.Present {
		if input.SSHPrivateKey.Value == nil {
			result.sshKey = nil
		} else {
			field, err := encryptValue(masterKey, *input.SSHPrivateKey.Value)
			if err != nil {
				return credentialFields{}, err
			}
			result.sshKey = &field
		}
	}
	return result, nil
}

func (s Service) insertAuditLogTx(ctx context.Context, tx pgx.Tx, userID, action, targetID string, details map[string]any, ipAddress string) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal gateway audit details: %w", err)
	}
	_, err = tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress", "createdAt")
VALUES ($1, $2, $3::"AuditAction", 'Gateway', $4, $5::jsonb, NULLIF($6, ''), NOW())
`, uuid.NewString(), userID, action, targetID, string(payload), ipAddress)
	if err != nil {
		return fmt.Errorf("insert gateway audit log: %w", err)
	}
	return nil
}

func encryptedFieldFromRecord(ciphertext, iv, tag *string) *encryptedField {
	if ciphertext == nil || iv == nil || tag == nil {
		return nil
	}
	return &encryptedField{
		Ciphertext: *ciphertext,
		IV:         *iv,
		Tag:        *tag,
	}
}

func validateCreatePayload(input createPayload) error {
	if strings.TrimSpace(input.Name) == "" {
		return &requestError{status: http.StatusBadRequest, message: "name is required"}
	}
	switch strings.ToUpper(strings.TrimSpace(input.Type)) {
	case "GUACD", "SSH_BASTION", "MANAGED_SSH", "DB_PROXY":
	default:
		return &requestError{status: http.StatusBadRequest, message: "type must be one of GUACD, SSH_BASTION, MANAGED_SSH, DB_PROXY"}
	}
	if strings.TrimSpace(input.Host) == "" {
		return &requestError{status: http.StatusBadRequest, message: "host is required"}
	}
	if input.Port < 1 || input.Port > 65535 {
		return &requestError{status: http.StatusBadRequest, message: "port must be between 1 and 65535"}
	}
	if input.APIPort != nil && (*input.APIPort < 1 || *input.APIPort > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "apiPort must be between 1 and 65535"}
	}
	if input.MonitorIntervalMS != nil && (*input.MonitorIntervalMS < 1000 || *input.MonitorIntervalMS > 3600000) {
		return &requestError{status: http.StatusBadRequest, message: "monitorIntervalMs must be between 1000 and 3600000"}
	}
	if input.InactivityTimeoutSeconds != nil && (*input.InactivityTimeoutSeconds < 60 || *input.InactivityTimeoutSeconds > 86400) {
		return &requestError{status: http.StatusBadRequest, message: "inactivityTimeoutSeconds must be between 60 and 86400"}
	}
	if input.LBStrategy != nil {
		switch strings.ToUpper(strings.TrimSpace(*input.LBStrategy)) {
		case "ROUND_ROBIN", "LEAST_CONNECTIONS":
		default:
			return &requestError{status: http.StatusBadRequest, message: "lbStrategy must be ROUND_ROBIN or LEAST_CONNECTIONS"}
		}
	}
	return nil
}

func validateUpdatePayload(gatewayType string, input updatePayload) error {
	if input.Port.Present && input.Port.Value != nil && (*input.Port.Value < 1 || *input.Port.Value > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "port must be between 1 and 65535"}
	}
	if input.APIPort.Present && input.APIPort.Value != nil && (*input.APIPort.Value < 1 || *input.APIPort.Value > 65535) {
		return &requestError{status: http.StatusBadRequest, message: "apiPort must be between 1 and 65535"}
	}
	if input.MonitorIntervalMS.Present && input.MonitorIntervalMS.Value != nil && (*input.MonitorIntervalMS.Value < 1000 || *input.MonitorIntervalMS.Value > 3600000) {
		return &requestError{status: http.StatusBadRequest, message: "monitorIntervalMs must be between 1000 and 3600000"}
	}
	if input.InactivityTimeoutSeconds.Present && input.InactivityTimeoutSeconds.Value != nil && (*input.InactivityTimeoutSeconds.Value < 60 || *input.InactivityTimeoutSeconds.Value > 86400) {
		return &requestError{status: http.StatusBadRequest, message: "inactivityTimeoutSeconds must be between 60 and 86400"}
	}
	if input.LBStrategy.Present && input.LBStrategy.Value != nil {
		switch strings.ToUpper(strings.TrimSpace(*input.LBStrategy.Value)) {
		case "ROUND_ROBIN", "LEAST_CONNECTIONS":
		default:
			return &requestError{status: http.StatusBadRequest, message: "lbStrategy must be ROUND_ROBIN or LEAST_CONNECTIONS"}
		}
	}
	if gatewayType != "SSH_BASTION" && (input.Username.Present || input.Password.Present || input.SSHPrivateKey.Present) {
		return &requestError{status: http.StatusBadRequest, message: "Credentials can only be set for SSH_BASTION gateways"}
	}
	return nil
}

func changedGatewayFields(input updatePayload) []string {
	fields := make([]string, 0)
	if input.Name.Present {
		fields = append(fields, "name")
	}
	if input.Host.Present {
		fields = append(fields, "host")
	}
	if input.Port.Present {
		fields = append(fields, "port")
	}
	if input.Description.Present {
		fields = append(fields, "description")
	}
	if input.IsDefault.Present {
		fields = append(fields, "isDefault")
	}
	if input.Username.Present {
		fields = append(fields, "username")
	}
	if input.Password.Present {
		fields = append(fields, "password")
	}
	if input.SSHPrivateKey.Present {
		fields = append(fields, "sshPrivateKey")
	}
	if input.APIPort.Present {
		fields = append(fields, "apiPort")
	}
	if input.PublishPorts.Present {
		fields = append(fields, "publishPorts")
	}
	if input.LBStrategy.Present {
		fields = append(fields, "lbStrategy")
	}
	if input.MonitoringEnabled.Present {
		fields = append(fields, "monitoringEnabled")
	}
	if input.MonitorIntervalMS.Present {
		fields = append(fields, "monitorIntervalMs")
	}
	if input.InactivityTimeoutSeconds.Present {
		fields = append(fields, "inactivityTimeoutSeconds")
	}
	return fields
}

func boolValue(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func intValue(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func stringValue(value *string, fallback string) string {
	if value == nil {
		return fallback
	}
	return strings.ToUpper(strings.TrimSpace(*value))
}

func trimStringPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	return &trimmed
}

func intPtr(value int) *int {
	return &value
}

func chooseString(current string, update optionalString) string {
	if !update.Present || update.Value == nil {
		return current
	}
	return strings.TrimSpace(*update.Value)
}

func chooseNullableString(current *string, update optionalString) *string {
	if !update.Present {
		return current
	}
	if update.Value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*update.Value)
	return &trimmed
}

func chooseInt(current int, update optionalInt) int {
	if !update.Present || update.Value == nil {
		return current
	}
	return *update.Value
}

func chooseNullableInt(current *int, update optionalInt) *int {
	if !update.Present {
		return current
	}
	if update.Value == nil {
		return nil
	}
	value := *update.Value
	return &value
}

func chooseBool(current bool, update optionalBool) bool {
	if !update.Present || update.Value == nil {
		return current
	}
	return *update.Value
}

func hasText(value *string) bool {
	return value != nil && strings.TrimSpace(*value) != ""
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}
