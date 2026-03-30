package sshsessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

func (s Service) loadAccess(ctx context.Context, userID, tenantID, connectionID string) (connectionAccess, error) {
	if conn, err := s.loadOwnerConnection(ctx, connectionID, userID); err == nil {
		return connectionAccess{Connection: conn, AccessType: "owner"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return connectionAccess{}, err
	}

	if conn, err := s.loadTeamConnection(ctx, connectionID, userID, tenantID); err == nil {
		return connectionAccess{Connection: conn, AccessType: "team"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return connectionAccess{}, err
	}

	if conn, err := s.loadSharedConnection(ctx, connectionID, userID, tenantID); err == nil {
		return connectionAccess{Connection: conn, AccessType: "shared"}, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return connectionAccess{}, err
	}

	return connectionAccess{}, &requestError{status: 404, message: "Connection not found or credentials unavailable"}
}

func (s Service) loadOwnerConnection(ctx context.Context, connectionID, userID string) (connectionRecord, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.type::text,
	c.host,
	c.port,
	c."teamId",
	c."gatewayId",
	c."credentialSecretId",
	c."externalVaultProviderId",
	c."externalVaultPath",
	c."dlpPolicy",
	c."encryptedUsername",
	c."usernameIV",
	c."usernameTag",
	c."encryptedPassword",
	c."passwordIV",
	c."passwordTag",
	c."encryptedDomain",
	c."domainIV",
	c."domainTag"
FROM "Connection" c
WHERE c.id = $1
  AND c."userId" = $2
  AND c."teamId" IS NULL
`)
	return scanConnectionRecord(row, connectionID, userID)
}

func (s Service) loadTeamConnection(ctx context.Context, connectionID, userID, tenantID string) (connectionRecord, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.type::text,
	c.host,
	c.port,
	c."teamId",
	c."gatewayId",
	c."credentialSecretId",
	c."externalVaultProviderId",
	c."externalVaultPath",
	c."dlpPolicy",
	c."encryptedUsername",
	c."usernameIV",
	c."usernameTag",
	c."encryptedPassword",
	c."passwordIV",
	c."passwordTag",
	c."encryptedDomain",
	c."domainIV",
	c."domainTag"
FROM "Connection" c
JOIN "TeamMember" tm ON tm."teamId" = c."teamId" AND tm."userId" = $2
JOIN "Team" t ON t.id = c."teamId"
WHERE c.id = $1
  AND c."teamId" IS NOT NULL
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
  AND ($3 = '' OR t."tenantId" = $3)
`, connectionID, userID, tenantID)
	return scanConnectionRecord(row)
}

func (s Service) loadSharedConnection(ctx context.Context, connectionID, userID, tenantID string) (connectionRecord, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	c.id,
	c.type::text,
	c.host,
	c.port,
	c."teamId",
	c."gatewayId",
	c."credentialSecretId",
	c."externalVaultProviderId",
	c."externalVaultPath",
	c."dlpPolicy",
	c."encryptedUsername",
	c."usernameIV",
	c."usernameTag",
	c."encryptedPassword",
	c."passwordIV",
	c."passwordTag",
	c."encryptedDomain",
	c."domainIV",
	c."domainTag",
	sc."encryptedUsername",
	sc."usernameIV",
	sc."usernameTag",
	sc."encryptedPassword",
	sc."passwordIV",
	sc."passwordTag",
	sc."encryptedDomain",
	sc."domainIV",
	sc."domainTag"
FROM "SharedConnection" sc
JOIN "Connection" c ON c.id = sc."connectionId"
LEFT JOIN "Team" t ON t.id = c."teamId"
WHERE c.id = $1
  AND sc."sharedWithUserId" = $2
  AND ($3 = '' OR c."teamId" IS NULL OR t."tenantId" = $3)
`, connectionID, userID, tenantID)

	var conn connectionRecord
	var dlp []byte
	if err := row.Scan(
		&conn.ID,
		&conn.Type,
		&conn.Host,
		&conn.Port,
		&conn.TeamID,
		&conn.GatewayID,
		&conn.CredentialSecretID,
		&conn.ExternalVaultProviderID,
		&conn.ExternalVaultPath,
		&dlp,
		&conn.EncryptedUsername,
		&conn.UsernameIV,
		&conn.UsernameTag,
		&conn.EncryptedPassword,
		&conn.PasswordIV,
		&conn.PasswordTag,
		&conn.EncryptedDomain,
		&conn.DomainIV,
		&conn.DomainTag,
		&conn.SharedEncryptedUsername,
		&conn.SharedUsernameIV,
		&conn.SharedUsernameTag,
		&conn.SharedEncryptedPassword,
		&conn.SharedPasswordIV,
		&conn.SharedPasswordTag,
		&conn.SharedEncryptedDomain,
		&conn.SharedDomainIV,
		&conn.SharedDomainTag,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return connectionRecord{}, pgx.ErrNoRows
		}
		return connectionRecord{}, fmt.Errorf("load shared connection: %w", err)
	}
	conn.DLPPolicy = normalizeRawJSON(dlp)
	return conn, nil
}

func scanConnectionRecord(row pgx.Row, _ ...any) (connectionRecord, error) {
	var conn connectionRecord
	var dlp []byte
	if err := row.Scan(
		&conn.ID,
		&conn.Type,
		&conn.Host,
		&conn.Port,
		&conn.TeamID,
		&conn.GatewayID,
		&conn.CredentialSecretID,
		&conn.ExternalVaultProviderID,
		&conn.ExternalVaultPath,
		&dlp,
		&conn.EncryptedUsername,
		&conn.UsernameIV,
		&conn.UsernameTag,
		&conn.EncryptedPassword,
		&conn.PasswordIV,
		&conn.PasswordTag,
		&conn.EncryptedDomain,
		&conn.DomainIV,
		&conn.DomainTag,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return connectionRecord{}, pgx.ErrNoRows
		}
		return connectionRecord{}, fmt.Errorf("load connection: %w", err)
	}
	conn.DLPPolicy = normalizeRawJSON(dlp)
	return conn, nil
}

func normalizeRawJSON(value []byte) json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	clone := make([]byte, len(value))
	copy(clone, value)
	return clone
}
