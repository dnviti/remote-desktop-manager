package connections

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) CreateConnection(ctx context.Context, claims authn.Claims, payload createPayload, ip *string) (connectionResponse, error) {
	if payload.CredentialSecretID != nil || payload.ExternalVaultProviderID != nil || payload.ExternalVaultPath != nil || payload.TeamID != nil || payload.FolderID != nil {
		return connectionResponse{}, ErrLegacyConnectionFlow
	}
	if strings.EqualFold(payload.Type, "DB_TUNNEL") {
		return connectionResponse{}, ErrLegacyConnectionFlow
	}
	if payload.Username == nil || payload.Password == nil {
		return connectionResponse{}, &requestError{status: 400, message: "Either credentialSecretId, externalVaultProviderId, or both username and password must be provided"}
	}

	if s.DB == nil {
		return connectionResponse{}, errors.New("database is unavailable")
	}
	key, err := s.getVaultKey(ctx, claims.UserID)
	if err != nil {
		return connectionResponse{}, err
	}
	if len(key) == 0 {
		return connectionResponse{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(key)

	username := strings.TrimSpace(*payload.Username)
	password := *payload.Password
	if username == "" || password == "" {
		return connectionResponse{}, &requestError{status: 400, message: "username and password are required"}
	}

	name := strings.TrimSpace(payload.Name)
	host := strings.TrimSpace(payload.Host)
	if name == "" {
		return connectionResponse{}, &requestError{status: 400, message: "name is required"}
	}
	if host == "" {
		return connectionResponse{}, &requestError{status: 400, message: "host is required"}
	}
	if payload.Port < 1 || payload.Port > 65535 {
		return connectionResponse{}, &requestError{status: 400, message: "port must be between 1 and 65535"}
	}
	if !validConnectionType(payload.Type) {
		return connectionResponse{}, &requestError{status: 400, message: "type must be one of RDP, SSH, VNC, DATABASE, DB_TUNNEL"}
	}

	encUser, err := encryptValue(key, username)
	if err != nil {
		return connectionResponse{}, err
	}
	encPassword, err := encryptValue(key, password)
	if err != nil {
		return connectionResponse{}, err
	}
	var encDomain *encryptedField
	if payload.Domain != nil && strings.TrimSpace(*payload.Domain) != "" {
		encrypted, err := encryptValue(key, strings.TrimSpace(*payload.Domain))
		if err != nil {
			return connectionResponse{}, err
		}
		encDomain = &encrypted
	}

	var connection connectionResponse
	connectionID := uuid.NewString()
	var teamID, credentialSecretID, credentialSecretName, credentialSecretType sql.NullString
	var externalVaultProviderID, externalVaultPath, description sql.NullString
	var gatewayID, defaultCredentialMode sql.NullString
	var targetDBHost, dbType, bastionConnectionID sql.NullString
	var targetDBPort sql.NullInt32
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy []byte

	row := s.DB.QueryRow(ctx, `
INSERT INTO "Connection" (
	id,
	"name",
	type,
	host,
	port,
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
	$30
)
RETURNING
	id,
	"name",
	type::text,
	host,
	port,
	"folderId",
	"teamId",
	"credentialSecretId",
	NULL::text,
	NULL::text,
	"externalVaultProviderId",
	"externalVaultPath",
	description,
	"isFavorite",
	"enableDrive",
	"gatewayId",
	"sshTerminalConfig",
	"rdpSettings",
	"vncSettings",
	"dbSettings",
	"defaultCredentialMode",
	"dlpPolicy",
	"targetDbHost",
	"targetDbPort",
	"dbType",
	"bastionConnectionId",
	"createdAt",
	"updatedAt"
`,
		connectionID,
		name,
		strings.ToUpper(payload.Type),
		host,
		payload.Port,
		claims.UserID,
		encUser.Ciphertext,
		encUser.IV,
		encUser.Tag,
		encPassword.Ciphertext,
		encPassword.IV,
		encPassword.Tag,
		nullCiphertext(encDomain),
		nullIV(encDomain),
		nullTag(encDomain),
		nullableString(payload.Description),
		boolOrDefault(payload.EnableDrive, false),
		nullableString(payload.GatewayID),
		nullableJSON(payload.SSHTerminalConfig),
		nullableJSON(payload.RDPSettings),
		nullableJSON(payload.VNCSettings),
		nullableJSON(payload.DBSettings),
		nullableJSON(payload.DLPPolicy),
		nullableString(payload.DefaultCredentialMode),
		nullableString(payload.TargetDBHost),
		nullableInt(payload.TargetDBPort),
		nullableString(payload.DBType),
		nullableString(payload.BastionConnectionID),
		time.Now(),
		time.Now(),
	)
	if err := row.Scan(
		&connection.ID,
		&connection.Name,
		&connection.Type,
		&connection.Host,
		&connection.Port,
		&connection.FolderID,
		&teamID,
		&credentialSecretID,
		&credentialSecretName,
		&credentialSecretType,
		&externalVaultProviderID,
		&externalVaultPath,
		&description,
		&connection.IsFavorite,
		&connection.EnableDrive,
		&gatewayID,
		&sshConfig,
		&rdpSettings,
		&vncSettings,
		&dbSettings,
		&defaultCredentialMode,
		&dlpPolicy,
		&targetDBHost,
		&targetDBPort,
		&dbType,
		&bastionConnectionID,
		&connection.CreatedAt,
		&connection.UpdatedAt,
	); err != nil {
		return connectionResponse{}, fmt.Errorf("create connection: %w", err)
	}

	connection.Scope = "private"
	connection.IsOwner = true
	applyNulls(&connection, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy)
	_ = s.insertAuditLog(ctx, claims.UserID, "CREATE_CONNECTION", connection.ID, map[string]any{
		"name":   connection.Name,
		"type":   connection.Type,
		"host":   connection.Host,
		"teamId": nil,
	}, ip)
	return connection, nil
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
		Description: payload.Description,
	}
	return s.CreateConnection(ctx, claims, create, ip)
}

func (s Service) UpdateConnection(ctx context.Context, claims authn.Claims, connectionID string, payload updatePayload, ip *string) (connectionResponse, error) {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return connectionResponse{}, err
	}
	if access.AccessType == "shared" {
		return connectionResponse{}, pgx.ErrNoRows
	}
	if access.AccessType == "team" {
		return connectionResponse{}, ErrLegacyConnectionFlow
	}
	if access.Connection.TeamID != nil ||
		payload.CredentialSecretID.Present ||
		payload.ExternalVaultProviderID.Present ||
		payload.ExternalVaultPath.Present ||
		payload.FolderID.Present {
		return connectionResponse{}, ErrLegacyConnectionFlow
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
	if payload.Type.Present {
		if payload.Type.Value == nil {
			return connectionResponse{}, &requestError{status: 400, message: "type is required"}
		}
		connType := strings.ToUpper(strings.TrimSpace(*payload.Type.Value))
		if !validConnectionType(connType) {
			return connectionResponse{}, &requestError{status: 400, message: "type must be one of RDP, SSH, VNC, DATABASE, DB_TUNNEL"}
		}
		if connType == "DB_TUNNEL" {
			return connectionResponse{}, ErrLegacyConnectionFlow
		}
		updates = append(updates, fmt.Sprintf(`type = $%d::"ConnectionType"`, len(args)+1))
		args = append(args, connType)
	}
	if payload.Host.Present {
		if payload.Host.Value == nil || strings.TrimSpace(*payload.Host.Value) == "" {
			return connectionResponse{}, &requestError{status: 400, message: "host is required"}
		}
		addUpdate(`host`, strings.TrimSpace(*payload.Host.Value))
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
	if payload.EnableDrive.Present {
		if payload.EnableDrive.Value == nil {
			return connectionResponse{}, &requestError{status: 400, message: "enableDrive must be a boolean"}
		}
		addUpdate(`"enableDrive"`, *payload.EnableDrive.Value)
	}
	if payload.GatewayID.Present {
		addUpdate(`"gatewayId"`, nullableString(payload.GatewayID.Value))
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

	needsVaultKey := payload.Username.Present || payload.Password.Present || payload.Domain.Present
	var key []byte
	if needsVaultKey {
		key, err = s.getVaultKey(ctx, claims.UserID)
		if err != nil {
			return connectionResponse{}, err
		}
		if len(key) == 0 {
			return connectionResponse{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
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

func (s Service) DeleteConnection(ctx context.Context, claims authn.Claims, connectionID string, ip *string) error {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return err
	}
	if access.AccessType == "shared" {
		return pgx.ErrNoRows
	}
	if access.AccessType == "team" && (access.Connection.TeamRole == nil || !canManageTeam(*access.Connection.TeamRole)) {
		return pgx.ErrNoRows
	}
	command, err := s.DB.Exec(ctx, `DELETE FROM "Connection" WHERE id = $1`, connectionID)
	if err != nil {
		return fmt.Errorf("delete connection: %w", err)
	}
	if command.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "DELETE_CONNECTION", connectionID, nil, ip)
	return nil
}

func (s Service) ToggleFavorite(ctx context.Context, claims authn.Claims, connectionID string, ip *string) (map[string]any, error) {
	access, err := s.resolveAccess(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return nil, err
	}
	switch access.AccessType {
	case "shared":
		return nil, &requestError{status: 403, message: "Cannot favorite shared connections"}
	case "team":
		if access.Connection.TeamRole == nil || !canManageTeam(*access.Connection.TeamRole) {
			return nil, &requestError{status: 403, message: "Viewers cannot toggle favorites on team connections"}
		}
	}

	var isFavorite bool
	if err := s.DB.QueryRow(ctx, `UPDATE "Connection" SET "isFavorite" = NOT "isFavorite" WHERE id = $1 RETURNING "isFavorite"`, connectionID).Scan(&isFavorite); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("toggle favorite: %w", err)
	}
	_ = s.insertAuditLog(ctx, claims.UserID, "CONNECTION_FAVORITE", connectionID, map[string]any{"isFavorite": isFavorite}, ip)
	return map[string]any{"id": connectionID, "isFavorite": isFavorite}, nil
}
