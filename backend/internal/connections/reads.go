package connections

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s Service) ListConnections(ctx context.Context, userID, tenantID string) (listResponse, error) {
	ownRows, err := s.DB.Query(ctx, `
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
	c."targetDbHost",
	c."targetDbPort",
	c."dbType",
	c."bastionConnectionId",
	c."createdAt",
	c."updatedAt"
FROM "Connection" c
LEFT JOIN "VaultSecret" vs ON vs.id = c."credentialSecretId"
WHERE c."userId" = $1
  AND c."teamId" IS NULL
ORDER BY c.name ASC
`, userID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list own connections: %w", err)
	}
	defer ownRows.Close()

	own, err := scanConnectionRows(ownRows, func(c *connectionResponse) {
		c.Scope = "private"
		c.IsOwner = true
	})
	if err != nil {
		return listResponse{}, err
	}

	sharedRows, err := s.DB.Query(ctx, `
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
WHERE sc."sharedWithUserId" = $1
  AND ($2 = '' OR c."teamId" IS NULL OR t."tenantId" = $2)
ORDER BY c.name ASC
`, userID, tenantID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list shared connections: %w", err)
	}
	defer sharedRows.Close()

	var shared []connectionResponse
	for sharedRows.Next() {
		conn, permission, sharedBy, err := scanConnectionWithShare(sharedRows)
		if err != nil {
			return listResponse{}, err
		}
		conn.Scope = "shared"
		conn.IsOwner = false
		conn.Permission = permission
		conn.SharedBy = sharedBy
		shared = append(shared, conn)
	}
	if err := sharedRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate shared connections: %w", err)
	}

	teamRows, err := s.DB.Query(ctx, `
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
	c."targetDbHost",
	c."targetDbPort",
	c."dbType",
	c."bastionConnectionId",
	c."createdAt",
	c."updatedAt",
	tm.role::text,
	t.name
FROM "Connection" c
JOIN "TeamMember" tm ON tm."teamId" = c."teamId" AND tm."userId" = $1
JOIN "Team" t ON t.id = c."teamId"
LEFT JOIN "VaultSecret" vs ON vs.id = c."credentialSecretId"
WHERE c."teamId" IS NOT NULL
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($2 = '' OR t."tenantId" = $2)
ORDER BY c.name ASC
`, userID, tenantID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list team connections: %w", err)
	}
	defer teamRows.Close()

	var team []connectionResponse
	for teamRows.Next() {
		conn, teamRole, teamName, err := scanConnectionWithTeam(teamRows)
		if err != nil {
			return listResponse{}, err
		}
		conn.Scope = "team"
		conn.IsOwner = false
		conn.TeamRole = teamRole
		conn.TeamName = teamName
		team = append(team, conn)
	}
	if err := teamRows.Err(); err != nil {
		return listResponse{}, fmt.Errorf("iterate team connections: %w", err)
	}

	return listResponse{Own: own, Shared: shared, Team: team}, nil
}

func (s Service) GetConnection(ctx context.Context, userID, tenantID, connectionID string) (connectionResponse, error) {
	access, err := s.resolveAccess(ctx, userID, tenantID, connectionID)
	if err != nil {
		return connectionResponse{}, err
	}
	return access.Connection, nil
}

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
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy []byte
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
	applyNulls(&conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy)
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

func scanConnectionRows(rows pgx.Rows, decorate func(*connectionResponse)) ([]connectionResponse, error) {
	var items []connectionResponse
	for rows.Next() {
		conn, err := scanSingleConnection(rows)
		if err != nil {
			return nil, err
		}
		decorate(&conn)
		items = append(items, conn)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate connections: %w", err)
	}
	return items, nil
}

func scanSingleConnection(row rowScanner) (connectionResponse, error) {
	var conn connectionResponse
	var teamID, credentialSecretID, credentialSecretName, credentialSecretType sql.NullString
	var externalVaultProviderID, externalVaultPath, description sql.NullString
	var gatewayID, defaultCredentialMode sql.NullString
	var targetDBHost, dbType, bastionConnectionID sql.NullString
	var targetDBPort sql.NullInt32
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy []byte
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
		&targetDBHost,
		&targetDBPort,
		&dbType,
		&bastionConnectionID,
		&conn.CreatedAt,
		&conn.UpdatedAt,
	); err != nil {
		return connectionResponse{}, err
	}
	applyNulls(&conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy)
	return conn, nil
}

func scanConnectionWithTeam(row rowScanner) (connectionResponse, *string, *string, error) {
	conn, err := scanSingleConnectionWithSuffix(row, true, false)
	if err != nil {
		return connectionResponse{}, nil, nil, err
	}
	return conn.conn, conn.teamRole, conn.teamName, nil
}

func scanConnectionWithShare(row rowScanner) (connectionResponse, *string, *string, error) {
	conn, err := scanSingleConnectionWithSuffix(row, false, true)
	if err != nil {
		return connectionResponse{}, nil, nil, err
	}
	return conn.conn, conn.permission, conn.sharedBy, nil
}

type scannedConnectionExtras struct {
	conn       connectionResponse
	teamRole   *string
	teamName   *string
	permission *string
	sharedBy   *string
}

func scanSingleConnectionWithSuffix(row rowScanner, withTeam, withShare bool) (scannedConnectionExtras, error) {
	conn, err := scanSingleConnectionPrefix(row, withTeam, withShare)
	if err != nil {
		return scannedConnectionExtras{}, err
	}
	return conn, nil
}

func scanSingleConnectionPrefix(row rowScanner, withTeam, withShare bool) (scannedConnectionExtras, error) {
	var extras scannedConnectionExtras
	var teamID, credentialSecretID, credentialSecretName, credentialSecretType sql.NullString
	var externalVaultProviderID, externalVaultPath, description sql.NullString
	var gatewayID, defaultCredentialMode sql.NullString
	var targetDBHost, dbType, bastionConnectionID sql.NullString
	var targetDBPort sql.NullInt32
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy []byte
	var teamRole, teamName, permission, sharedBy sql.NullString

	dest := []any{
		&extras.conn.ID,
		&extras.conn.Name,
		&extras.conn.Type,
		&extras.conn.Host,
		&extras.conn.Port,
		&extras.conn.FolderID,
		&teamID,
		&credentialSecretID,
		&credentialSecretName,
		&credentialSecretType,
		&externalVaultProviderID,
		&externalVaultPath,
		&description,
		&extras.conn.IsFavorite,
		&extras.conn.EnableDrive,
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
		&extras.conn.CreatedAt,
		&extras.conn.UpdatedAt,
	}
	if withTeam {
		dest = append(dest, &teamRole, &teamName)
	}
	if withShare {
		dest = append(dest, &permission, &sharedBy)
	}
	if err := row.Scan(dest...); err != nil {
		return scannedConnectionExtras{}, err
	}
	applyNulls(&extras.conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy)
	if teamRole.Valid {
		extras.teamRole = &teamRole.String
	}
	if teamName.Valid {
		extras.teamName = &teamName.String
	}
	if permission.Valid {
		extras.permission = &permission.String
	}
	if sharedBy.Valid {
		extras.sharedBy = &sharedBy.String
	}
	return extras, nil
}

func applyNulls(
	conn *connectionResponse,
	teamID, credentialSecretID, credentialSecretName, credentialSecretType sql.NullString,
	externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode sql.NullString,
	targetDBHost sql.NullString,
	targetDBPort sql.NullInt32,
	dbType, bastionConnectionID sql.NullString,
	sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy []byte,
) {
	if teamID.Valid {
		conn.TeamID = &teamID.String
	}
	if credentialSecretID.Valid {
		conn.CredentialSecretID = &credentialSecretID.String
	}
	if credentialSecretName.Valid {
		conn.CredentialSecretName = &credentialSecretName.String
	}
	if credentialSecretType.Valid {
		conn.CredentialSecretType = &credentialSecretType.String
	}
	if externalVaultProviderID.Valid {
		conn.ExternalVaultProviderID = &externalVaultProviderID.String
	}
	if externalVaultPath.Valid {
		conn.ExternalVaultPath = &externalVaultPath.String
	}
	if description.Valid {
		conn.Description = &description.String
	}
	if gatewayID.Valid {
		conn.GatewayID = &gatewayID.String
	}
	if defaultCredentialMode.Valid {
		conn.DefaultCredentialMode = &defaultCredentialMode.String
	}
	if targetDBHost.Valid {
		conn.TargetDBHost = &targetDBHost.String
	}
	if targetDBPort.Valid {
		v := int(targetDBPort.Int32)
		conn.TargetDBPort = &v
	}
	if dbType.Valid {
		conn.DBType = &dbType.String
	}
	if bastionConnectionID.Valid {
		conn.BastionConnectionID = &bastionConnectionID.String
	}
	conn.SSHTerminalConfig = normalizeRawJSON(sshConfig)
	conn.RDPSettings = normalizeRawJSON(rdpSettings)
	conn.VNCSettings = normalizeRawJSON(vncSettings)
	conn.DBSettings = normalizeRawJSON(dbSettings)
	conn.DLPPolicy = normalizeRawJSON(dlpPolicy)
}
