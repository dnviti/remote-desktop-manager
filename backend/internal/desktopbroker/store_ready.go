package desktopbroker

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func (s *PostgresSessionStore) RecordDesktopConnectionReady(ctx context.Context, tokenHash, connectionID string) error {
	if tokenHash == "" || connectionID == "" {
		return nil
	}

	payload, err := json.Marshal(map[string]string{
		sessions.MetadataKeyDesktopConnectionID: connectionID,
	})
	if err != nil {
		return fmt.Errorf("marshal desktop connection metadata: %w", err)
	}

	if _, err := s.db.Exec(
		ctx,
		`WITH target AS (
			SELECT id, COALESCE(metadata, '{}'::jsonb) AS metadata
			FROM "ActiveSession"
			WHERE "guacTokenHash" = $1
			  AND status <> 'CLOSED'::"SessionStatus"
			ORDER BY "startedAt" DESC
			LIMIT 1
		)
		UPDATE "ActiveSession" s
		   SET metadata = target.metadata || $2::jsonb,
		       "lastActivityAt" = NOW()
		  FROM target
		 WHERE s.id = target.id`,
		tokenHash,
		payload,
	); err != nil {
		return fmt.Errorf("record desktop connection ready: %w", err)
	}

	return nil
}
