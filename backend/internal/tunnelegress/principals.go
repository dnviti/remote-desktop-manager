package tunnelegress

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func LoadActiveTeamIDs(ctx context.Context, db *pgxpool.Pool, tenantID, userID string) ([]string, error) {
	if db == nil || strings.TrimSpace(tenantID) == "" || strings.TrimSpace(userID) == "" {
		return nil, nil
	}
	rows, err := db.Query(ctx, `
SELECT tm."teamId"
FROM "TeamMember" tm
JOIN "Team" t ON t.id = tm."teamId"
WHERE tm."userId" = $1
  AND t."tenantId" = $2
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
ORDER BY tm."teamId" ASC
`, strings.TrimSpace(userID), strings.TrimSpace(tenantID))
	if err != nil {
		return nil, fmt.Errorf("load active egress team ids: %w", err)
	}
	defer rows.Close()

	ids := make([]string, 0)
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan active egress team id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate active egress team ids: %w", err)
	}
	return ids, nil
}
