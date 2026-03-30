package tunnelbroker

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Store interface {
	LoadGatewayAuth(ctx context.Context, gatewayID string) (GatewayAuthRecord, error)
	MarkTunnelConnected(ctx context.Context, gatewayID string, connectedAt time.Time, clientVersion, clientIP string) error
	MarkTunnelDisconnected(ctx context.Context, gatewayID string) error
	MarkTunnelHeartbeat(ctx context.Context, gatewayID string, heartbeatAt time.Time, heartbeat *HeartbeatMetadata) error
	InsertTunnelAudit(ctx context.Context, action, gatewayID, clientIP string, details map[string]any) error
}

type GatewayAuthRecord struct {
	GatewayID             string
	TenantID              string
	TunnelEnabled         bool
	EncryptedTunnelToken  string
	TunnelTokenIV         string
	TunnelTokenTag        string
	TunnelTokenHash       string
	TenantTunnelCACertPEM string
}

type NoopStore struct{}

func (NoopStore) LoadGatewayAuth(context.Context, string) (GatewayAuthRecord, error) {
	return GatewayAuthRecord{}, fmt.Errorf("tunnel broker store is not configured")
}

func (NoopStore) MarkTunnelConnected(context.Context, string, time.Time, string, string) error {
	return nil
}

func (NoopStore) MarkTunnelDisconnected(context.Context, string) error {
	return nil
}

func (NoopStore) MarkTunnelHeartbeat(context.Context, string, time.Time, *HeartbeatMetadata) error {
	return nil
}

func (NoopStore) InsertTunnelAudit(context.Context, string, string, string, map[string]any) error {
	return nil
}

type PostgresStore struct {
	db *pgxpool.Pool
}

func NewPostgresStore(db *pgxpool.Pool) Store {
	if db == nil {
		return NoopStore{}
	}
	return &PostgresStore{db: db}
}

func (s *PostgresStore) LoadGatewayAuth(ctx context.Context, gatewayID string) (GatewayAuthRecord, error) {
	row := s.db.QueryRow(
		ctx,
		`SELECT g.id,
		        g."tenantId",
		        g."tunnelEnabled",
		        COALESCE(g."encryptedTunnelToken", ''),
		        COALESCE(g."tunnelTokenIV", ''),
		        COALESCE(g."tunnelTokenTag", ''),
		        COALESCE(g."tunnelTokenHash", ''),
		        COALESCE(t."tunnelCaCert", '')
		   FROM "Gateway" g
		   JOIN "Tenant" t ON t.id = g."tenantId"
		  WHERE g.id = $1`,
		gatewayID,
	)

	var record GatewayAuthRecord
	if err := row.Scan(
		&record.GatewayID,
		&record.TenantID,
		&record.TunnelEnabled,
		&record.EncryptedTunnelToken,
		&record.TunnelTokenIV,
		&record.TunnelTokenTag,
		&record.TunnelTokenHash,
		&record.TenantTunnelCACertPEM,
	); err != nil {
		return GatewayAuthRecord{}, err
	}

	return record, nil
}

func (s *PostgresStore) MarkTunnelConnected(ctx context.Context, gatewayID string, connectedAt time.Time, clientVersion, clientIP string) error {
	_, err := s.db.Exec(
		ctx,
		`UPDATE "Gateway"
		    SET "tunnelConnectedAt" = $2,
		        "tunnelLastHeartbeat" = $2,
		        "tunnelClientVersion" = NULLIF($3, ''),
		        "tunnelClientIp" = NULLIF($4, '')
		  WHERE id = $1`,
		gatewayID,
		connectedAt.UTC(),
		clientVersion,
		clientIP,
	)
	return err
}

func (s *PostgresStore) MarkTunnelDisconnected(ctx context.Context, gatewayID string) error {
	_, err := s.db.Exec(
		ctx,
		`UPDATE "Gateway"
		    SET "tunnelConnectedAt" = NULL,
		        "tunnelLastHeartbeat" = NULL
		  WHERE id = $1`,
		gatewayID,
	)
	return err
}

func (s *PostgresStore) MarkTunnelHeartbeat(ctx context.Context, gatewayID string, heartbeatAt time.Time, heartbeat *HeartbeatMetadata) error {
	_, err := s.db.Exec(
		ctx,
		`UPDATE "Gateway"
		    SET "tunnelLastHeartbeat" = $2
		  WHERE id = $1`,
		gatewayID,
		heartbeatAt.UTC(),
	)
	if err != nil {
		return err
	}

	if heartbeat == nil {
		return nil
	}

	status := "healthy"
	if !heartbeat.Healthy {
		status = "unhealthy"
	}

	_, err = s.db.Exec(
		ctx,
		`UPDATE "ManagedGatewayInstance"
		    SET "healthStatus" = $2,
		        "lastHealthCheck" = $3
		  WHERE "gatewayId" = $1
		    AND status = 'RUNNING'::"ManagedInstanceStatus"`,
		gatewayID,
		status,
		heartbeatAt.UTC(),
	)
	return err
}

func (s *PostgresStore) InsertTunnelAudit(ctx context.Context, action, gatewayID, clientIP string, details map[string]any) error {
	if action == "" {
		return nil
	}

	payload := "null"
	if details != nil {
		encoded, err := json.Marshal(details)
		if err != nil {
			return fmt.Errorf("marshal tunnel audit details: %w", err)
		}
		payload = string(encoded)
	}

	_, err := s.db.Exec(
		ctx,
		fmt.Sprintf(`INSERT INTO "AuditLog" (
			id, action, "targetType", "targetId", details, "ipAddress", "gatewayId", "geoCoords", flags
		) VALUES (
			$1, '%s'::"AuditAction", 'Gateway', $2, $3::jsonb, NULLIF($4, ''), $2, ARRAY[]::double precision[], ARRAY[]::text[]
		)`, action),
		uuid.NewString(),
		gatewayID,
		payload,
		clientIP,
	)
	if err != nil {
		return fmt.Errorf("insert tunnel audit: %w", err)
	}

	return nil
}
