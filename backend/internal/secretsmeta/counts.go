package secretsmeta

import (
	"context"
	"fmt"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

type countsResponse struct {
	PwnedCount    int `json:"pwnedCount"`
	ExpiringCount int `json:"expiringCount"`
}

func (s Service) HandleCounts(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.LoadCounts(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) LoadCounts(ctx context.Context, userID, tenantID string) (countsResponse, error) {
	var result countsResponse
	if s.DB == nil {
		return result, fmt.Errorf("database is unavailable")
	}

	if err := s.DB.QueryRow(ctx, `
WITH accessible AS (
	SELECT DISTINCT vs.id, COALESCE(vs."pwnedCount", 0) AS "pwnedCount", vs."expiresAt"
	FROM "VaultSecret" vs
	WHERE
		(vs.scope = 'PERSONAL' AND vs."userId" = $1)
		OR ($2 <> '' AND vs.scope = 'TENANT' AND vs."tenantId" = $2)
		OR (vs.scope = 'TEAM' AND EXISTS (
			SELECT 1
			FROM "TeamMember" tm
			WHERE tm."teamId" = vs."teamId"
			  AND tm."userId" = $1
		))
		OR EXISTS (
			SELECT 1
			FROM "SharedSecret" ss
			WHERE ss."secretId" = vs.id
			  AND ss."sharedWithUserId" = $1
		)
)
SELECT
	COUNT(*) FILTER (WHERE "pwnedCount" > 0),
	COUNT(*) FILTER (WHERE "expiresAt" IS NOT NULL AND "expiresAt" <= NOW() + INTERVAL '7 days')
FROM accessible
`, userID, tenantID).Scan(&result.PwnedCount, &result.ExpiringCount); err != nil {
		return countsResponse{}, fmt.Errorf("load secret counts: %w", err)
	}

	return result, nil
}
