package sessionadmin

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type Service struct {
	Store      *sessions.Store
	TenantAuth tenantauth.Service
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	protocol := normalizeProtocol(r.URL.Query().Get("protocol"))
	items, err := s.Store.ListActiveSessions(r.Context(), sessions.ActiveSessionFilter{
		TenantID:  claims.TenantID,
		Protocol:  protocol,
		GatewayID: strings.TrimSpace(r.URL.Query().Get("gatewayId")),
	})
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleCount(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	count, err := s.Store.CountActiveSessions(r.Context(), sessions.ActiveSessionFilter{TenantID: claims.TenantID})
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"count": count})
}

func (s Service) HandleCountByGateway(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	counts, err := s.Store.CountActiveSessionsByGateway(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, counts)
}

func (s Service) HandleTerminate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if !s.authorized(w, r, claims) {
		return nil
	}
	result, err := s.Store.TerminateTenantSession(r.Context(), r.PathValue("sessionId"), claims.TenantID, claims.UserID, requestIP(r))
	if err != nil {
		switch {
		case errors.Is(err, sessions.ErrLegacySessionAdminFlow):
			return err
		case errors.Is(err, sessions.ErrSessionNotFound):
			app.ErrorJSON(w, http.StatusNotFound, "Session not found")
			return nil
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			return nil
		}
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":         true,
		"sessionId":  result.ID,
		"protocol":   result.Protocol,
		"terminated": true,
	})
	return nil
}

func (s Service) authorized(w http.ResponseWriter, r *http.Request, claims authn.Claims) bool {
	if claims.TenantID == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return false
	}

	membership, err := s.TenantAuth.ResolveMembership(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return false
	}
	if membership == nil {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}

	switch membership.Role {
	case "ADMIN", "OWNER", "AUDITOR", "OPERATOR":
	default:
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}

	if !membership.Permissions[tenantauth.CanManageSessions] {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return false
	}
	return true
}

func normalizeProtocol(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "SSH", "RDP", "VNC", "DATABASE", "DB_TUNNEL", "SSH_PROXY":
		return strings.ToUpper(strings.TrimSpace(value))
	default:
		return ""
	}
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			if value != "" {
				return &value
			}
		}
	}
	if value := strings.TrimSpace(r.RemoteAddr); value != "" {
		return &value
	}
	return nil
}
