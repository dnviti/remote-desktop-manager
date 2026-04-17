package connections

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
)

func (s Service) CreateConnection(ctx context.Context, claims authn.Claims, payload createPayload, ip *string) (connectionResponse, error) {
	credentialSecretID := normalizeOptionalStringPtrValue(payload.CredentialSecretID)
	externalVaultProviderID := normalizeOptionalStringPtrValue(payload.ExternalVaultProviderID)
	externalVaultPath := normalizeOptionalStringPtrValue(payload.ExternalVaultPath)
	teamID := normalizeOptionalStringPtrValue(payload.TeamID)
	folderID := normalizeOptionalStringPtrValue(payload.FolderID)

	if credentialSecretID == nil && externalVaultProviderID == nil && (payload.Username == nil || payload.Password == nil) {
		return connectionResponse{}, &requestError{status: 400, message: "Either credentialSecretId, externalVaultProviderId, or both username and password must be provided"}
	}
	if s.DB == nil {
		return connectionResponse{}, errors.New("database is unavailable")
	}

	name := strings.TrimSpace(payload.Name)
	host := strings.TrimSpace(payload.Host)
	connType := strings.ToUpper(strings.TrimSpace(payload.Type))
	if name == "" {
		return connectionResponse{}, &requestError{status: 400, message: "name is required"}
	}
	if host == "" {
		return connectionResponse{}, &requestError{status: 400, message: "host is required"}
	}
	if payload.Port < 1 || payload.Port > 65535 {
		return connectionResponse{}, &requestError{status: 400, message: "port must be between 1 and 65535"}
	}
	if !validConnectionType(connType) {
		return connectionResponse{}, &requestError{status: 400, message: "type must be one of RDP, SSH, VNC, DATABASE, DB_TUNNEL"}
	}
	if err := validateConnectionHost(ctx, host); err != nil {
		return connectionResponse{}, err
	}

	transferRetentionPolicy, err := normalizeTransferRetentionPolicyInput(payload.TransferRetentionPolicy)
	if err != nil {
		return connectionResponse{}, err
	}

	gatewayID := normalizeOptionalStringPtrValue(payload.GatewayID)
	if gatewayRoutingMandatoryEnabled() && gatewayID == nil && connectionTypeRequiresGateway(connType) {
		resolvedGatewayID, err := s.resolveDefaultGatewayID(ctx, claims.TenantID, connType)
		if err != nil {
			return connectionResponse{}, err
		}
		gatewayID = resolvedGatewayID
	}
	if gatewayID != nil {
		if err := s.validateGatewayForConnectionType(ctx, claims.TenantID, *gatewayID, connType); err != nil {
			return connectionResponse{}, err
		}
	}
	if teamID != nil {
		if _, err := s.requireTeamRole(ctx, claims.UserID, claims.TenantID, *teamID); err != nil {
			return connectionResponse{}, err
		}
	}
	if credentialSecretID != nil {
		if err := s.validateCredentialSecretReference(ctx, claims.UserID, claims.TenantID, *credentialSecretID, connType); err != nil {
			return connectionResponse{}, err
		}
	}

	var (
		key         []byte
		encUser     *encryptedField
		encPassword *encryptedField
		encDomain   *encryptedField
	)
	if payload.Username != nil && payload.Password != nil {
		key, err = s.resolveConnectionEncryptionKey(ctx, claims.UserID, teamID)
		if err != nil {
			return connectionResponse{}, err
		}
		defer zeroBytes(key)

		username := strings.TrimSpace(*payload.Username)
		password := *payload.Password
		if username == "" || password == "" {
			return connectionResponse{}, &requestError{status: 400, message: "username and password are required"}
		}

		encryptedUsername, err := encryptValue(key, username)
		if err != nil {
			return connectionResponse{}, err
		}
		encUser = &encryptedUsername

		encryptedPassword, err := encryptValue(key, password)
		if err != nil {
			return connectionResponse{}, err
		}
		encPassword = &encryptedPassword

		if payload.Domain != nil && strings.TrimSpace(*payload.Domain) != "" {
			encryptedDomain, err := encryptValue(key, strings.TrimSpace(*payload.Domain))
			if err != nil {
				return connectionResponse{}, err
			}
			encDomain = &encryptedDomain
		}
	}

	connectionID := uuid.NewString()
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "Connection" (
	id,
	"name",
	type,
	host,
	port,
	"folderId",
	"teamId",
	"credentialSecretId",
	"externalVaultProviderId",
	"externalVaultPath",
	"userId",
	"encryptedUsername",
	"usernameIV",
	"usernameTag",
	"encryptedPassword",
	"passwordIV",
	"passwordTag",
	"encryptedDomain",
	"domainIV",
	"domainTag",
	description,
	"enableDrive",
	"gatewayId",
	"sshTerminalConfig",
	"rdpSettings",
	"vncSettings",
	"dbSettings",
	"dlpPolicy",
	"transferRetentionPolicy",
	"defaultCredentialMode",
	"targetDbHost",
	"targetDbPort",
	"dbType",
	"bastionConnectionId",
	"createdAt",
	"updatedAt"
)
VALUES (
	$1,
	$2,
	$3::"ConnectionType",
	$4,
	$5,
	$6,
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
	$19,
	$20,
	$21,
	$22,
	$23,
	$24,
	$25,
	$26,
	$27,
	$28,
	$29,
	$30,
	$31,
	$32,
	$33,
	$34,
	$35,
	$36
)
RETURNING id
`,
		connectionID,
		name,
		connType,
		host,
		payload.Port,
		nullableString(folderID),
		nullableString(teamID),
		nullableString(credentialSecretID),
		nullableString(externalVaultProviderID),
		nullableString(externalVaultPath),
		claims.UserID,
		nullCiphertext(encUser),
		nullIV(encUser),
		nullTag(encUser),
		nullCiphertext(encPassword),
		nullIV(encPassword),
		nullTag(encPassword),
		nullCiphertext(encDomain),
		nullIV(encDomain),
		nullTag(encDomain),
		nullableString(payload.Description),
		boolOrDefault(payload.EnableDrive, false),
		nullableString(gatewayID),
		nullableJSON(payload.SSHTerminalConfig),
		nullableJSON(payload.RDPSettings),
		nullableJSON(payload.VNCSettings),
		nullableJSON(payload.DBSettings),
		nullableJSON(payload.DLPPolicy),
		nullableJSON(transferRetentionPolicy),
		nullableString(payload.DefaultCredentialMode),
		nullableString(payload.TargetDBHost),
		nullableInt(payload.TargetDBPort),
		nullableString(payload.DBType),
		nullableString(payload.BastionConnectionID),
		time.Now(),
		time.Now(),
	).Scan(&connectionID); err != nil {
		return connectionResponse{}, fmt.Errorf("create connection: %w", err)
	}

	_ = s.insertAuditLog(ctx, claims.UserID, "CREATE_CONNECTION", connectionID, map[string]any{
		"name":   name,
		"type":   connType,
		"host":   host,
		"teamId": teamID,
	}, ip)
	return s.GetConnection(ctx, claims.UserID, claims.TenantID, connectionID)
}

func (s Service) ImportSimpleConnection(ctx context.Context, claims authn.Claims, payload ImportPayload, ip *string) (connectionResponse, error) {
	username := strings.TrimSpace(payload.Username)
	password := payload.Password
	create := createPayload{
		Name:        strings.TrimSpace(payload.Name),
		Type:        strings.TrimSpace(payload.Type),
		Host:        strings.TrimSpace(payload.Host),
		Port:        payload.Port,
		Username:    &username,
		Password:    &password,
		Domain:      payload.Domain,
		FolderID:    payload.FolderID,
		Description: payload.Description,
	}
	return s.CreateConnection(ctx, claims, create, ip)
}
