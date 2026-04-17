package connections

import (
	"context"
	"fmt"
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
	c."transferRetentionPolicy",
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
WHERE sc."sharedWithUserId" = $1
  AND ($2 = '' OR c."teamId" IS NULL OR t."tenantId" = $2)
ORDER BY c.name ASC
`, userID, tenantID)
	if err != nil {
		return listResponse{}, fmt.Errorf("list shared connections: %w", err)
	}
	defer sharedRows.Close()

	shared := make([]connectionResponse, 0)
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

	team := make([]connectionResponse, 0)
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

	return normalizeListResponse(listResponse{Own: own, Shared: shared, Team: team}), nil
}

func (s Service) GetConnection(ctx context.Context, userID, tenantID, connectionID string) (connectionResponse, error) {
	access, err := s.resolveAccess(ctx, userID, tenantID, connectionID)
	if err != nil {
		return connectionResponse{}, err
	}
	return access.Connection, nil
}
