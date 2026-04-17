package connections

import (
	"database/sql"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func scanConnectionRows(rows pgx.Rows, decorate func(*connectionResponse)) ([]connectionResponse, error) {
	items := make([]connectionResponse, 0)
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
	); err != nil {
		return connectionResponse{}, err
	}
	applyNulls(&conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy)
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
	var sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy []byte
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
		&transferRetentionPolicy,
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
	applyNulls(&extras.conn, teamID, credentialSecretID, credentialSecretName, credentialSecretType, externalVaultProviderID, externalVaultPath, description, gatewayID, defaultCredentialMode, targetDBHost, targetDBPort, dbType, bastionConnectionID, sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy)
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
	sshConfig, rdpSettings, vncSettings, dbSettings, dlpPolicy, transferRetentionPolicy []byte,
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
	conn.TransferRetentionPolicy = ResolveTransferRetentionPolicy(transferRetentionPolicy)
}
