package connections

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) UpdateConnection(ctx context.Context, claims authn.Claims, connectionID string, payload updatePayload, ip *string) (connectionResponse, error) {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return connectionResponse{}, err
	}
	if access.AccessType == "shared" {
		return connectionResponse{}, pgx.ErrNoRows
	}
	if access.AccessType == "team" && (access.Connection.TeamRole == nil || !canManageTeam(*access.Connection.TeamRole)) {
		return connectionResponse{}, pgx.ErrNoRows
	}

	var updates []string
	var args []any
	addUpdate := func(column string, value any) {
		updates = append(updates, fmt.Sprintf(`%s = $%d`, column, len(args)+1))
		args = append(args, value)
	}

	if payload.Name.Present {
		if payload.Name.Value == nil || strings.TrimSpace(*payload.Name.Value) == "" {
			return connectionResponse{}, &requestError{status: 400, message: "name is required"}
		}
		addUpdate(`name`, strings.TrimSpace(*payload.Name.Value))
	}

	effectiveType := access.Connection.Type
	if payload.Type.Present {
		if payload.Type.Value == nil {
			return connectionResponse{}, &requestError{status: 400, message: "type is required"}
		}
		connType := strings.ToUpper(strings.TrimSpace(*payload.Type.Value))
		if !validConnectionType(connType) {
			return connectionResponse{}, &requestError{status: 400, message: "type must be one of RDP, SSH, VNC, DATABASE, DB_TUNNEL"}
		}
		effectiveType = connType
		updates = append(updates, fmt.Sprintf(`type = $%d::"ConnectionType"`, len(args)+1))
		args = append(args, connType)
	}
	if payload.Host.Present {
		if payload.Host.Value == nil || strings.TrimSpace(*payload.Host.Value) == "" {
			return connectionResponse{}, &requestError{status: 400, message: "host is required"}
		}
		host := strings.TrimSpace(*payload.Host.Value)
		if err := validateConnectionHost(ctx, host); err != nil {
			return connectionResponse{}, err
		}
		addUpdate(`host`, host)
	}
	if payload.Port.Present {
		if payload.Port.Value == nil || *payload.Port.Value < 1 || *payload.Port.Value > 65535 {
			return connectionResponse{}, &requestError{status: 400, message: "port must be between 1 and 65535"}
		}
		addUpdate(`port`, *payload.Port.Value)
	}
	if payload.Description.Present {
		addUpdate(`description`, nullableString(payload.Description.Value))
	}
	if payload.FolderID.Present {
		addUpdate(`"folderId"`, nullableString(payload.FolderID.Value))
	}
	if payload.EnableDrive.Present {
		if payload.EnableDrive.Value == nil {
			return connectionResponse{}, &requestError{status: 400, message: "enableDrive must be a boolean"}
		}
		addUpdate(`"enableDrive"`, *payload.EnableDrive.Value)
	}
	if payload.SSHTerminalConfig.Present {
		addUpdate(`"sshTerminalConfig"`, nullableJSON(payload.SSHTerminalConfig.Value))
	}
	if payload.RDPSettings.Present {
		addUpdate(`"rdpSettings"`, nullableJSON(payload.RDPSettings.Value))
	}
	if payload.VNCSettings.Present {
		addUpdate(`"vncSettings"`, nullableJSON(payload.VNCSettings.Value))
	}
	if payload.DBSettings.Present {
		addUpdate(`"dbSettings"`, nullableJSON(payload.DBSettings.Value))
	}
	if payload.DLPPolicy.Present {
		addUpdate(`"dlpPolicy"`, nullableJSON(payload.DLPPolicy.Value))
	}
	if payload.TransferRetentionPolicy.Present {
		transferRetentionPolicy, err := normalizeTransferRetentionPolicyInput(payload.TransferRetentionPolicy.Value)
		if err != nil {
			return connectionResponse{}, err
		}
		addUpdate(`"transferRetentionPolicy"`, nullableJSON(transferRetentionPolicy))
	}
	if payload.DefaultCredentialMode.Present {
		addUpdate(`"defaultCredentialMode"`, nullableString(payload.DefaultCredentialMode.Value))
	}
	if payload.TargetDBHost.Present {
		addUpdate(`"targetDbHost"`, nullableString(payload.TargetDBHost.Value))
	}
	if payload.TargetDBPort.Present {
		addUpdate(`"targetDbPort"`, nullableInt(payload.TargetDBPort.Value))
	}
	if payload.DBType.Present {
		addUpdate(`"dbType"`, nullableString(payload.DBType.Value))
	}
	if payload.BastionConnectionID.Present {
		addUpdate(`"bastionConnectionId"`, nullableString(payload.BastionConnectionID.Value))
	}

	effectiveGatewayID := normalizeOptionalStringPtrValue(access.Connection.GatewayID)
	if payload.GatewayID.Present {
		effectiveGatewayID = normalizeOptionalStringPtrValue(payload.GatewayID.Value)
	}
	if gatewayRoutingMandatoryEnabled() && effectiveGatewayID == nil && connectionTypeRequiresGateway(effectiveType) {
		effectiveGatewayID, err = s.resolveDefaultGatewayID(ctx, claims.TenantID, effectiveType)
		if err != nil {
			return connectionResponse{}, err
		}
	}
	if effectiveGatewayID != nil {
		if err := s.validateGatewayForConnectionType(ctx, claims.TenantID, *effectiveGatewayID, effectiveType); err != nil {
			return connectionResponse{}, err
		}
	}
	if payload.GatewayID.Present || !optionalStringPointersEqual(access.Connection.GatewayID, effectiveGatewayID) {
		addUpdate(`"gatewayId"`, nullableString(effectiveGatewayID))
	}

	if payload.CredentialSecretID.Present {
		secretID := normalizeOptionalStringPtrValue(payload.CredentialSecretID.Value)
		if secretID == nil {
			addUpdate(`"credentialSecretId"`, nil)
		} else {
			if err := s.validateCredentialSecretReference(ctx, claims.UserID, claims.TenantID, *secretID, effectiveType); err != nil {
				return connectionResponse{}, err
			}
			addUpdate(`"credentialSecretId"`, *secretID)
			addUpdate(`"externalVaultProviderId"`, nil)
			addUpdate(`"externalVaultPath"`, nil)
			addUpdate(`"encryptedUsername"`, nil)
			addUpdate(`"usernameIV"`, nil)
			addUpdate(`"usernameTag"`, nil)
			addUpdate(`"encryptedPassword"`, nil)
			addUpdate(`"passwordIV"`, nil)
			addUpdate(`"passwordTag"`, nil)
			addUpdate(`"encryptedDomain"`, nil)
			addUpdate(`"domainIV"`, nil)
			addUpdate(`"domainTag"`, nil)
		}
	}
	if payload.ExternalVaultProviderID.Present {
		providerID := normalizeOptionalStringPtrValue(payload.ExternalVaultProviderID.Value)
		pathValue := normalizeOptionalStringPtrValue(payload.ExternalVaultPath.Value)
		addUpdate(`"externalVaultProviderId"`, nullableString(providerID))
		addUpdate(`"externalVaultPath"`, nullableString(pathValue))
		if providerID != nil {
			addUpdate(`"credentialSecretId"`, nil)
			addUpdate(`"encryptedUsername"`, nil)
			addUpdate(`"usernameIV"`, nil)
			addUpdate(`"usernameTag"`, nil)
			addUpdate(`"encryptedPassword"`, nil)
			addUpdate(`"passwordIV"`, nil)
			addUpdate(`"passwordTag"`, nil)
			addUpdate(`"encryptedDomain"`, nil)
			addUpdate(`"domainIV"`, nil)
			addUpdate(`"domainTag"`, nil)
		}
	}

	needsVaultKey := payload.Username.Present || payload.Password.Present || payload.Domain.Present
	var key []byte
	if needsVaultKey {
		key, err = s.resolveConnectionEncryptionKey(ctx, claims.UserID, access.Connection.TeamID)
		if err != nil {
			return connectionResponse{}, err
		}
		defer zeroBytes(key)
	}

	if payload.Username.Present {
		if payload.Username.Value == nil || strings.TrimSpace(*payload.Username.Value) == "" {
			return connectionResponse{}, &requestError{status: 400, message: "username must be a non-empty string"}
		}
		encrypted, err := encryptValue(key, strings.TrimSpace(*payload.Username.Value))
		if err != nil {
			return connectionResponse{}, err
		}
		addUpdate(`"encryptedUsername"`, encrypted.Ciphertext)
		addUpdate(`"usernameIV"`, encrypted.IV)
		addUpdate(`"usernameTag"`, encrypted.Tag)
	}
	if payload.Password.Present {
		if payload.Password.Value == nil || *payload.Password.Value == "" {
			return connectionResponse{}, &requestError{status: 400, message: "password must be a non-empty string"}
		}
		encrypted, err := encryptValue(key, *payload.Password.Value)
		if err != nil {
			return connectionResponse{}, err
		}
		addUpdate(`"encryptedPassword"`, encrypted.Ciphertext)
		addUpdate(`"passwordIV"`, encrypted.IV)
		addUpdate(`"passwordTag"`, encrypted.Tag)
	}
	if payload.Domain.Present {
		if payload.Domain.Value == nil || strings.TrimSpace(*payload.Domain.Value) == "" {
			addUpdate(`"encryptedDomain"`, nil)
			addUpdate(`"domainIV"`, nil)
			addUpdate(`"domainTag"`, nil)
		} else {
			encrypted, err := encryptValue(key, strings.TrimSpace(*payload.Domain.Value))
			if err != nil {
				return connectionResponse{}, err
			}
			addUpdate(`"encryptedDomain"`, encrypted.Ciphertext)
			addUpdate(`"domainIV"`, encrypted.IV)
			addUpdate(`"domainTag"`, encrypted.Tag)
		}
	}

	if len(updates) == 0 {
		return access.Connection, nil
	}

	addUpdate(`"updatedAt"`, time.Now())
	args = append(args, connectionID)
	query := fmt.Sprintf(`UPDATE "Connection" SET %s WHERE id = $%d`, strings.Join(updates, ", "), len(args))
	command, err := s.DB.Exec(ctx, query, args...)
	if err != nil {
		return connectionResponse{}, fmt.Errorf("update connection: %w", err)
	}
	if command.RowsAffected() == 0 {
		return connectionResponse{}, pgx.ErrNoRows
	}

	updated, err := s.GetConnection(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return connectionResponse{}, err
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "UPDATE_CONNECTION", connectionID, map[string]any{
		"fields": presentUpdateFields(payload),
	}, ip)
	return updated, nil
}
