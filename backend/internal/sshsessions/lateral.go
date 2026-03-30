package sshsessions

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"
)

func (s Service) checkLateralMovement(ctx context.Context, userID, connectionID, ipAddress string) (bool, error) {
	if !parseEnvBool("LATERAL_MOVEMENT_DETECTION_ENABLED", true) {
		return true, nil
	}

	windowMinutes := parseEnvInt("LATERAL_MOVEMENT_WINDOW_MINUTES", 5)
	threshold := parseEnvInt("LATERAL_MOVEMENT_MAX_DISTINCT_TARGETS", 10)
	lockoutMinutes := parseEnvInt("LATERAL_MOVEMENT_LOCKOUT_MINUTES", 30)

	since := time.Now().UTC().Add(-time.Duration(windowMinutes) * time.Minute)
	rows, err := s.DB.Query(ctx, `
SELECT DISTINCT "targetId"
FROM "AuditLog"
WHERE "userId" = $1
  AND action = 'SESSION_START'::"AuditAction"
  AND "createdAt" >= $2
  AND "targetId" IS NOT NULL
`, userID, since)
	if err != nil {
		return false, fmt.Errorf("check lateral movement: %w", err)
	}
	defer rows.Close()

	targets := map[string]struct{}{connectionID: {}}
	for rows.Next() {
		var targetID string
		if err := rows.Scan(&targetID); err != nil {
			return false, fmt.Errorf("scan lateral movement target: %w", err)
		}
		if targetID != "" {
			targets[targetID] = struct{}{}
		}
	}
	if err := rows.Err(); err != nil {
		return false, fmt.Errorf("iterate lateral movement targets: %w", err)
	}
	if len(targets) <= threshold {
		return true, nil
	}

	details, _ := json.Marshal(map[string]any{
		"distinctTargets":     len(targets),
		"threshold":           threshold,
		"windowMinutes":       windowMinutes,
		"recentConnectionIds": mapKeys(targets),
		"deniedConnectionId":  connectionID,
	})
	_, _ = s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress", "createdAt")
VALUES ($1, $2, 'ANOMALOUS_LATERAL_MOVEMENT'::"AuditAction", 'User', $3, $4::jsonb, NULLIF($5, ''), NOW())
`, uuid.NewString(), userID, userID, string(details), ipAddress)
	_, _ = s.DB.Exec(ctx, `UPDATE "User" SET "lockedUntil" = $2 WHERE id = $1`, userID, time.Now().UTC().Add(time.Duration(lockoutMinutes)*time.Minute))
	return false, nil
}

func mapKeys(values map[string]struct{}) []string {
	result := make([]string, 0, len(values))
	for key := range values {
		result = append(result, key)
	}
	return result
}
