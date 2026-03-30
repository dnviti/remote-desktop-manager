package secretsmeta

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

type tenantVaultStatusResponse struct {
	Initialized bool `json:"initialized"`
	HasAccess   bool `json:"hasAccess"`
}

func (s Service) HandleTenantVaultStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.LoadTenantVaultStatus(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		if strings.Contains(err.Error(), "tenant context required") {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) LoadTenantVaultStatus(ctx context.Context, userID, tenantID string) (tenantVaultStatusResponse, error) {
	var result tenantVaultStatusResponse
	if strings.TrimSpace(tenantID) == "" {
		return result, fmt.Errorf("tenant context required")
	}
	if s.DB == nil {
		return result, fmt.Errorf("database is unavailable")
	}

	if err := s.DB.QueryRow(ctx, `
SELECT
	COALESCE(t."hasTenantVaultKey", false),
	EXISTS (
		SELECT 1
		FROM "TenantVaultMember" tvm
		WHERE tvm."tenantId" = t.id
		  AND tvm."userId" = $2
	)
FROM "Tenant" t
WHERE t.id = $1
`, tenantID, userID).Scan(&result.Initialized, &result.HasAccess); err != nil {
		return tenantVaultStatusResponse{}, fmt.Errorf("load tenant vault status: %w", err)
	}

	return result, nil
}
