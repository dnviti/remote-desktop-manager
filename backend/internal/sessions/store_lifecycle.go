package sessions

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s *Store) StartSession(ctx context.Context, params StartSessionParams) (string, error) {
	if s.db == nil {
		return "", errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin start session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	sessionID := uuid.NewString()
	metadataJSON, err := json.Marshal(params.Metadata)
	if err != nil {
		return "", fmt.Errorf("marshal session metadata: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "ActiveSession" (
			 id, "tenantId", "userId", "connectionId", "gatewayId", "instanceId", protocol, status, "socketId", "guacTokenHash", "ipAddress", metadata
		 ) VALUES (
			 $1, NULLIF($2, ''), $3, $4, NULLIF($5, ''), NULLIF($6, ''), $7::"SessionProtocol", 'ACTIVE'::"SessionStatus", NULLIF($8, ''), NULLIF($9, ''), NULLIF($10, ''), $11::jsonb
		 )`,
		sessionID,
		params.TenantID,
		params.UserID,
		params.ConnectionID,
		params.GatewayID,
		params.InstanceID,
		params.Protocol,
		params.SocketID,
		params.GuacTokenHash,
		params.IPAddress,
		string(metadataJSON),
	); err != nil {
		return "", fmt.Errorf("insert active session: %w", err)
	}

	if params.RecordingID != "" {
		if _, err := tx.Exec(
			ctx,
			`UPDATE "SessionRecording"
			    SET "sessionId" = $2
			  WHERE id = $1`,
			params.RecordingID,
			sessionID,
		); err != nil {
			return "", fmt.Errorf("link session recording: %w", err)
		}
	}

	detailsMap := make(map[string]any, len(params.Metadata)+8)
	for key, value := range params.Metadata {
		detailsMap[key] = value
	}
	detailsMap["sessionId"] = sessionID
	detailsMap["protocol"] = params.Protocol
	if params.RecordingID != "" {
		detailsMap["recordingId"] = params.RecordingID
	}
	if params.RoutingDecision != nil {
		if params.RoutingDecision.Strategy != "" {
			detailsMap["lbStrategy"] = params.RoutingDecision.Strategy
		}
		if params.RoutingDecision.CandidateCount > 0 {
			detailsMap["lbCandidates"] = params.RoutingDecision.CandidateCount
		}
		if params.RoutingDecision.SelectedSessionCount > 0 {
			detailsMap["lbSelectedSessions"] = params.RoutingDecision.SelectedSessionCount
		}
	}

	gatewayID := stringToPtr(params.GatewayID)
	if gatewayID != nil {
		gatewayName, err := loadGatewayName(ctx, tx, *gatewayID)
		if err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return "", fmt.Errorf("load gateway name: %w", err)
		}
		if gatewayName != "" {
			detailsMap["gatewayName"] = gatewayName
		}
		if params.InstanceID != "" {
			detailsMap["instanceId"] = params.InstanceID
		}
	}

	detailsJSON, err := json.Marshal(detailsMap)
	if err != nil {
		return "", fmt.Errorf("marshal session start audit details: %w", err)
	}

	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     params.UserID,
		Action:     "SESSION_START",
		TargetType: "Connection",
		TargetID:   params.ConnectionID,
		Details:    detailsJSON,
		IPAddress:  stringToPtr(params.IPAddress),
		GatewayID:  gatewayID,
	}); err != nil {
		return "", fmt.Errorf("insert session start audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit start session: %w", err)
	}

	return sessionID, nil
}

func (s *Store) EndOwnedSession(ctx context.Context, sessionID, userID, reason string) error {
	if s.db == nil {
		return errors.New("postgres is not configured")
	}

	tx, err := s.db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin end session: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	record, err := loadOwnedSessionForUpdate(ctx, tx, sessionID, userID)
	if err != nil {
		return err
	}

	if record.Status == "CLOSED" {
		if err := tx.Commit(ctx); err != nil {
			return fmt.Errorf("commit closed session end noop: %w", err)
		}
		return nil
	}

	closedAt := time.Now().UTC()
	if _, err := tx.Exec(
		ctx,
		`UPDATE "ActiveSession"
		    SET status = 'CLOSED'::"SessionStatus",
		        "endedAt" = $2
		  WHERE id = $1`,
		record.ID,
		closedAt,
	); err != nil {
		return fmt.Errorf("close session: %w", err)
	}

	recordingID, err := lookupRecordingID(ctx, tx, record.ID)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("lookup recording id: %w", err)
	}

	if record.GatewayID != nil && *record.GatewayID != "" {
		gatewayName, nameErr := loadGatewayName(ctx, tx, *record.GatewayID)
		if nameErr == nil && gatewayName != "" {
			record.GatewayName = &gatewayName
		}
	}

	details := map[string]any{
		"sessionId":         record.ID,
		"protocol":          record.Protocol,
		"durationMs":        closedAt.Sub(record.StartedAt).Milliseconds(),
		"durationFormatted": formatDuration(closedAt.Sub(record.StartedAt).Milliseconds()),
		"gatewayName":       stringPtrValue(record.GatewayName),
		"instanceId":        stringPtrValue(record.InstanceID),
	}
	if reason != "" {
		details["reason"] = reason
	}
	if recordingID != "" {
		details["recordingId"] = recordingID
	}

	detailsJSON, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal session end audit details: %w", err)
	}

	if err := insertAuditLog(ctx, tx, auditLogParams{
		UserID:     record.UserID,
		Action:     "SESSION_END",
		TargetType: "Connection",
		TargetID:   record.ConnectionID,
		Details:    detailsJSON,
		IPAddress:  record.IPAddress,
		GatewayID:  record.GatewayID,
	}); err != nil {
		return fmt.Errorf("insert session end audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit end session: %w", err)
	}
	if shouldAutoCompleteRecording(record.Protocol) {
		if err := completeSessionRecordings(ctx, s.db, []string{recordingID}); err != nil {
			return err
		}
	}
	if err := s.cleanupManagedSandboxes(ctx, []sessionRecord{*record}); err != nil {
		return err
	}

	return nil
}

func (s *Store) cleanupManagedSandboxes(ctx context.Context, records []sessionRecord) error {
	hook := loadSandboxCleanupHook()
	if hook == nil || s.db == nil || len(records) == 0 {
		return nil
	}

	targets, err := s.loadSandboxCleanupScopes(context.WithoutCancel(ctx), records)
	if err != nil {
		return err
	}
	for _, target := range targets {
		if err := hook(context.WithoutCancel(ctx), target); err != nil {
			return fmt.Errorf("cleanup managed sandbox for %s/%s/%s: %w", target.Protocol, target.UserID, target.ConnectionID, err)
		}
	}
	return nil
}

func (s *Store) loadSandboxCleanupScopes(ctx context.Context, records []sessionRecord) ([]SandboxCleanupScope, error) {
	unique := make(map[string]sessionRecord, len(records))
	for _, record := range records {
		key := record.UserID + "\x00" + record.ConnectionID + "\x00" + record.Protocol
		if _, exists := unique[key]; exists {
			continue
		}
		unique[key] = record
	}

	targets := make([]SandboxCleanupScope, 0, len(unique))
	for _, record := range unique {
		activeCount, err := s.countOpenSessionsForScope(ctx, record.UserID, record.ConnectionID, record.Protocol)
		if err != nil {
			return nil, err
		}
		if activeCount > 0 {
			continue
		}
		tenantID, tenantName, connectionName, userEmail, err := s.lookupSandboxCleanupMetadata(ctx, record.ConnectionID, record.UserID)
		if err != nil {
			return nil, err
		}
		targets = append(targets, SandboxCleanupScope{
			TenantID:       tenantID,
			TenantName:     tenantName,
			UserID:         record.UserID,
			UserEmail:      userEmail,
			ConnectionID:   record.ConnectionID,
			ConnectionName: connectionName,
			Protocol:       record.Protocol,
		})
	}
	return targets, nil
}

func (s *Store) lookupSandboxCleanupMetadata(ctx context.Context, connectionID, userID string) (string, string, string, string, error) {
	var tenantID, tenantName, connectionName, userEmail string
	err := s.db.QueryRow(ctx, `
SELECT
  COALESCE(tm."tenantId", latest_session."tenantId", ''),
  COALESCE(t.name, ''),
  COALESCE(c.name, ''),
  COALESCE(u.email, '')
FROM "Connection" c
LEFT JOIN "Team" tm ON tm.id = c."teamId"
LEFT JOIN LATERAL (
  SELECT s."tenantId"
  FROM "ActiveSession" s
  WHERE s."connectionId" = c.id
    AND s."userId" = $2
    AND s."tenantId" IS NOT NULL
  ORDER BY s."startedAt" DESC
  LIMIT 1
) latest_session ON true
LEFT JOIN "Tenant" t ON t.id = COALESCE(tm."tenantId", latest_session."tenantId")
LEFT JOIN "User" u ON u.id = $2
WHERE c.id = $1
`, connectionID, userID).Scan(&tenantID, &tenantName, &connectionName, &userEmail)
	if err != nil {
		return "", "", "", "", err
	}
	return tenantID, tenantName, connectionName, userEmail, nil
}

func (s *Store) countOpenSessionsForScope(ctx context.Context, userID, connectionID, protocol string) (int, error) {
	var count int
	if err := s.db.QueryRow(
		ctx,
		`SELECT COUNT(*)::int
		   FROM "ActiveSession"
		  WHERE "userId" = $1
		    AND "connectionId" = $2
		    AND protocol = $3::"SessionProtocol"
		    AND status <> 'CLOSED'::"SessionStatus"`,
		userID,
		connectionID,
		protocol,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count open sessions for cleanup: %w", err)
	}
	return count, nil
}

func (s *Store) lookupConnectionTenantID(ctx context.Context, connectionID string) (string, error) {
	var tenantID string
	if err := s.db.QueryRow(ctx, `
SELECT COALESCE(t."tenantId", '')
FROM "Connection" c
LEFT JOIN "Team" t ON t.id = c."teamId"
WHERE c.id = $1
`, connectionID).Scan(&tenantID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("lookup connection tenant for cleanup: %w", err)
	}
	return tenantID, nil
}
