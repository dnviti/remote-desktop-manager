package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
)

type SessionControlResult struct {
	ID           string
	UserID       string
	ConnectionID string
	Protocol     string
	Status       string
}

func (s *Store) PauseTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*SessionControlResult, error) {
	return s.updateTenantSessionStatus(ctx, sessionID, tenantID, adminUserID, ipAddress, SessionStatusPaused, "SESSION_PAUSE")
}

func (s *Store) ResumeTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*SessionControlResult, error) {
	return s.updateTenantSessionStatus(ctx, sessionID, tenantID, adminUserID, ipAddress, SessionStatusActive, "SESSION_RESUME")
}

func (s *Store) updateTenantSessionStatus(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string, targetStatus, auditAction string) (*SessionControlResult, error) {
	if s.db == nil {
		return nil, errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin update session status: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	row := tx.QueryRow(
		ctx,
		`SELECT s.id,
		        s."userId",
		        s."connectionId",
		        s.protocol::text,
		        s."gatewayId",
		        s."instanceId",
		        s."ipAddress",
		        s."startedAt",
		        s.status::text
		   FROM "ActiveSession" s
		  WHERE s.id = $1
		    AND s."tenantId" = $2
		  FOR UPDATE`,
		sessionID,
		tenantID,
	)
	record, err := scanSessionRecord(row)
	if err != nil {
		return nil, err
	}

	nextStatus, changed, err := nextAdminSessionStatus(record.Status, targetStatus)
	if err != nil {
		return nil, err
	}
	if changed {
		if _, err := tx.Exec(
			ctx,
			`UPDATE "ActiveSession"
			    SET status = $2::"SessionStatus"
			  WHERE id = $1`,
			record.ID,
			nextStatus,
		); err != nil {
			return nil, fmt.Errorf("update tenant session status: %w", err)
		}
	}

	detailsJSON, err := json.Marshal(map[string]any{
		"managedUserId": record.UserID,
		"protocol":      record.Protocol,
		"connectionId":  record.ConnectionID,
		"status":        nextStatus,
	})
	if err != nil {
		return nil, fmt.Errorf("marshal session control audit: %w", err)
	}
	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     adminUserID,
		Action:     auditAction,
		TargetType: "Session",
		TargetID:   record.ID,
		Details:    detailsJSON,
		IPAddress:  ipAddress,
	}); err != nil {
		return nil, fmt.Errorf("insert session control audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit update session status: %w", err)
	}

	return &SessionControlResult{
		ID:           record.ID,
		UserID:       record.UserID,
		ConnectionID: record.ConnectionID,
		Protocol:     record.Protocol,
		Status:       nextStatus,
	}, nil
}
