package sessionadmin

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

func (s Service) resolveSessionVisibility(w http.ResponseWriter, r *http.Request, claims authn.Claims) (*tenantauth.SessionVisibility, bool) {
	if claims.TenantID == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return nil, false
	}

	visibility, err := s.TenantAuth.ResolveSessionVisibility(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil, false
	}
	if visibility == nil {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return nil, false
	}
	return visibility, true
}
