package connections

import (
	"context"
	"database/sql"
	"errors"

	"github.com/jackc/pgx/v5"
)

func (s Service) resolveAccess(ctx context.Context, userID, tenantID, connectionID string) (accessResult, error) {
	if conn, err := s.loadOwnerConnection(ctx, connectionID, userID); err == nil {
		conn.Scope = "private"
		conn.IsOwner = true
		return accessResult{Connection: conn, AccessType: "owner"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return accessResult{}, err
	}

	if conn, err := s.loadTeamConnection(ctx, connectionID, userID, tenantID); err == nil {
		conn.Scope = "team"
		conn.IsOwner = false
		return accessResult{Connection: conn, AccessType: "team"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return accessResult{}, err
	}

	if conn, err := s.loadSharedConnection(ctx, connectionID, userID, tenantID); err == nil {
		conn.Scope = "shared"
		conn.IsOwner = false
		return accessResult{Connection: conn, AccessType: "shared"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return accessResult{}, err
	}

	return accessResult{}, pgx.ErrNoRows
}

func (s Service) loadOwnerConnection(ctx context.Context, connectionID, userID string) (connectionResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.name,
	c.type::text,
	c.host,
	c.port,
	c."folderId",
	c."teamId",
	c."credentialSecretId",
	vs.name,
	vs.type::text,
	c."externalVaultProviderId",
	c."externalVaultPath",
	c.description,
	c."isFavorite",
	c."enableDrive",
	c."gatewayId",
	c."sshTerminalConfig",
	c."rdpSettings",
	c."vncSettings",
	c."dbSettings",
	c."defaultCredentialMode",
	c."dlpPolicy",
	c."transferRetentionPolicy",
	c."targetDbHost",
	c."targetDbPort",
	c."dbType",
	c."bastionConnectionId",
	c."createdAt",
	c."updatedAt"
FROM "Connection" c
LEFT JOIN "VaultSecret" vs ON vs.id = c."credentialSecretId"
WHERE c.id = $1
  AND c."userId" = $2
  AND c."teamId" IS NULL
`, connectionID, userID)
	return scanSingleConnection(row)
}

func (s Service) loadTeamConnection(ctx context.Context, connectionID, userID, tenantID string) (connectionResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.name,
	c.type::text,
	c.host,
	c.port,
	c."folderId",
	c."teamId",
	c."credentialSecretId",
	vs.name,
	vs.type::text,
	c."externalVaultProviderId",
	c."externalVaultPath",
	c.description,
	c."isFavorite",
	c."enableDrive",
	c."gatewayId",
	c."sshTerminalConfig",
	c."rdpSettings",
	c."vncSettings",
	c."dbSettings",
	c."defaultCredentialMode",
	c."dlpPolicy",
	c."transferRetentionPolicy",
	c."targetDbHost",
	c."targetDbPort",
	c."dbType",
	c."bastionConnectionId",
	c."createdAt",
	c."updatedAt",
	tm.role::text,
	t.name
FROM "Connection" c
JOIN "TeamMember" tm ON tm."teamId" = c."teamId" AND tm."userId" = $2
JOIN "Team" t ON t.id = c."teamId"
LEFT JOIN "VaultSecret" vs ON vs.id = c."credentialSecretId"
WHERE c.id = $1
  AND c."teamId" IS NOT NULL
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($3 = '' OR t."tenantId" = $3)
`, connectionID, userID, tenantID)

	var conn connectionResponse
	var teamID, credentialSecretID, credentialSecretName, credentialSecretType sql.NullString
	var externalVaultProviderID, externalVaultPath, description sql.NullString
	var gatewayID, defaultCredentialMode, teamRole, teamName sql.NullString
	var targetDBHost, dbType, bastionConnectionID sql.NullString
	var targetDBPort sql.NullInt32
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy []byte
	if err := row.Scan(
		&conn.ID,
		&conn.Name,
		&conn.Type,
		&conn.Host,
		&conn.Port,
		&conn.FolderID,
		&teamID,
		&credentialSecretID,
		&credentialSecretName,
		&credentialSecretType,
		&externalVaultProviderID,
		&externalVaultPath,
		&description,
		&conn.IsFavorite,
		&conn.EnableDrive,
		&gatewayID,
		&sshConfig,
		&rdpSettings,
		&vncSettings,
		&dbSettings,
		&defaultCredentialMode,
		&dlpPolicy,
		&transferRetentionPolicy,
		&targetDBHost,
		&targetDBPort,
		&dbType,
		&bastionConnectionID,
		&conn.CreatedAt,
		&conn.UpdatedAt,
		&teamRole,
		&teamName,
	); err != nil {
		return connectionResponse{}, err
	}
	applyNulls(&conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy)
	if teamRole.Valid {
		conn.TeamRole = &teamRole.String
	}
	if teamName.Valid {
		conn.TeamName = &teamName.String
	}
	return conn, nil
}

func (s Service) loadSharedConnection(ctx context.Context, connectionID, userID, tenantID string) (connectionResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.name,
	c.type::text,
	c.host,
	c.port,
	NULL AS "folderId",
	NULL AS "teamId",
	c."credentialSecretId",
	vs.name,
	vs.type::text,
	c."externalVaultProviderId",
	c."externalVaultPath",
	c.description,
	false AS "isFavorite",
	c."enableDrive",
	c."gatewayId",
	c."sshTerminalConfig",
	c."rdpSettings",
	c."vncSettings",
	c."dbSettings",
	c."defaultCredentialMode",
	c."dlpPolicy",
	c."transferRetentionPolicy",
	c."targetDbHost",
	c."targetDbPort",
	c."dbType",
	c."bastionConnectionId",
	c."createdAt",
	c."updatedAt",
	sc.permission::text,
	sb.email
FROM "SharedConnection" sc
JOIN "Connection" c ON c.id = sc."connectionId"
LEFT JOIN "VaultSecret" vs ON vs.id = c."credentialSecretId"
JOIN "User" sb ON sb.id = sc."sharedByUserId"
LEFT JOIN "Team" t ON t.id = c."teamId"
WHERE sc."connectionId" = $1
  AND sc."sharedWithUserId" = $2
  AND ($3 = '' OR c."teamId" IS NULL OR t."tenantId" = $3)
`, connectionID, userID, tenantID)
	conn, permission, sharedBy, err := scanConnectionWithShare(row)
	if err != nil {
		return connectionResponse{}, err
	}
	conn.Permission = permission
	conn.SharedBy = sharedBy
	return conn, nil
}
