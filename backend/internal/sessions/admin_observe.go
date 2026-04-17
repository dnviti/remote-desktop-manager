package sessions

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

type TenantSessionSummary struct {
	ID                string
	UserID            string
	ConnectionID      string
	Protocol          string
	Status            string
	GatewayID         string
	InstanceID        string
	GuacdConnectionID string
}

func (s *Store) LoadTenantSessionSummary(ctx context.Context, sessionID, tenantID string) (*TenantSessionSummary, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	row := s.db.QueryRow(
		ctx,
		`SELECT s.id,
		        s."userId",
		        s."connectionId",
		        s.protocol::text,
		        s.status::text,
		        COALESCE(s."gatewayId", ''),
		        COALESCE(s."instanceId", ''),
		        COALESCE(s.metadata->>$3, '')
		   FROM "ActiveSession" s
		  WHERE s.id = $1
		    AND s."tenantId" = $2`,
		sessionID,
		tenantID,
		MetadataKeyDesktopConnectionID,
	)

	var summary TenantSessionSummary
	if err := row.Scan(
		&summary.ID,
		&summary.UserID,
		&summary.ConnectionID,
		&summary.Protocol,
		&summary.Status,
		&summary.GatewayID,
		&summary.InstanceID,
		&summary.GuacdConnectionID,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("load tenant session summary: %w", err)
	}

	summary.Protocol = normalizeProtocol(summary.Protocol)
	summary.Status = normalizeSessionStatus(summary.Status)
	return &summary, nil
}

func normalizeProtocol(protocol string) string {
	switch protocol = strings.ToUpper(strings.TrimSpace(protocol)); protocol {
	case "SSH", "RDP", "VNC", "DATABASE", "DB_TUNNEL", "SSH_PROXY":
		return protocol
	default:
		return protocol
	}
}
