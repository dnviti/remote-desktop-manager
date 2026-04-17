package files

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
)

type connectionFileTransferMetadata struct {
	ConnectionName string
	EnableDrive    bool
	TenantName     string
	UserEmail      string
}

func (s Service) loadConnectionFileTransferMetadata(ctx context.Context, connectionID, tenantID, userID string) (connectionFileTransferMetadata, error) {
	if s.DB == nil {
		return connectionFileTransferMetadata{}, nil
	}
	row := s.DB.QueryRow(ctx, `
SELECT
  c.name,
  c."enableDrive",
  COALESCE((SELECT t.name FROM "Tenant" t WHERE t.id = $2), ''),
  COALESCE((SELECT u.email FROM "User" u WHERE u.id = $3), '')
FROM "Connection" c
WHERE c.id = $1
`, strings.TrimSpace(connectionID), strings.TrimSpace(tenantID), strings.TrimSpace(userID))
	var meta connectionFileTransferMetadata
	if err := row.Scan(&meta.ConnectionName, &meta.EnableDrive, &meta.TenantName, &meta.UserEmail); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return connectionFileTransferMetadata{}, nil
		}
		return connectionFileTransferMetadata{}, err
	}
	return meta, nil
}

func (s Service) buildReadableManagedSandboxScope(ctx context.Context, protocol, tenantID, userID, connectionID string, connectionName string, fallbackUserEmail string) managedSandboxScope {
	meta, err := s.loadConnectionFileTransferMetadata(ctx, connectionID, tenantID, userID)
	if err != nil {
		return newManagedSandboxScopeWithLabels(protocol, tenantID, userID, connectionID, tenantID, firstNonEmpty(fallbackUserEmail, userID), firstNonEmpty(connectionName, connectionID))
	}
	return newManagedSandboxScopeWithLabels(
		protocol,
		tenantID,
		userID,
		connectionID,
		firstNonEmpty(meta.TenantName, tenantID),
		firstNonEmpty(fallbackUserEmail, meta.UserEmail, userID),
		firstNonEmpty(connectionName, meta.ConnectionName, connectionID),
	)
}

func (s Service) rdpDriveEnabled(ctx context.Context, tenantID, userID, connectionID string) (bool, error) {
	meta, err := s.loadConnectionFileTransferMetadata(ctx, connectionID, tenantID, userID)
	if err != nil {
		return false, err
	}
	return meta.EnableDrive, nil
}
