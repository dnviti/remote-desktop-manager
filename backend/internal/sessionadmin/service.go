package sessionadmin

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type sessionStore interface {
	ListActiveSessions(ctx context.Context, filters sessions.ActiveSessionFilter) ([]sessions.ActiveSessionDTO, error)
	CountActiveSessions(ctx context.Context, filters sessions.ActiveSessionFilter) (int, error)
	CountActiveSessionsByGateway(ctx context.Context, tenantID string) ([]sessions.GatewaySessionCount, error)
	ListSessionConsoleSessions(ctx context.Context, filters sessions.SessionConsoleFilter) ([]sessions.SessionConsoleDTO, error)
	CountSessionConsoleSessions(ctx context.Context, filters sessions.SessionConsoleFilter) (int, error)
	LoadTenantSessionSummary(ctx context.Context, sessionID, tenantID string) (*sessions.TenantSessionSummary, error)
	TerminateTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*sessions.TerminatedSession, error)
	PauseTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*sessions.SessionControlResult, error)
	ResumeTenantSession(ctx context.Context, sessionID, tenantID, adminUserID string, ipAddress *string) (*sessions.SessionControlResult, error)
}

type membershipResolver interface {
	ResolveMembership(ctx context.Context, userID, tenantID string) (*tenantauth.Membership, error)
	ResolveSessionVisibility(ctx context.Context, userID, tenantID string) (*tenantauth.SessionVisibility, error)
}

type Service struct {
	Store                 sessionStore
	TenantAuth            membershipResolver
	SSHObserverGrants     sshObserverGrantIssuer
	DesktopObserverGrants desktopObserverGrantIssuer
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	visibility, ok := s.resolveSessionVisibility(w, r, claims)
	if !ok {
		return
	}
	protocol := normalizeProtocol(r.URL.Query().Get("protocol"))
	items, err := s.Store.ListActiveSessions(r.Context(), activeSessionFilterForVisibility(claims, visibility, protocol, strings.TrimSpace(r.URL.Query().Get("gatewayId"))))
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func activeSessionFilterForVisibility(claims authn.Claims, visibility *tenantauth.SessionVisibility, protocol, gatewayID string) sessions.ActiveSessionFilter {
	filter := sessions.ActiveSessionFilter{
		TenantID:  claims.TenantID,
		Protocol:  protocol,
		GatewayID: gatewayID,
	}
	if visibility != nil && visibility.RequiresOwnerFilter() {
		filter.UserID = claims.UserID
	}
	return filter
}

func (s Service) HandleCount(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	visibility, ok := s.resolveSessionVisibility(w, r, claims)
	if !ok {
		return
	}
	count, err := s.Store.CountActiveSessions(r.Context(), activeSessionFilterForVisibility(claims, visibility, "", ""))
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"count": count})
}

func (s Service) HandleCountByGateway(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims, tenantauth.CanViewSessions) {
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
	if !s.authorized(w, r, claims, tenantauth.CanControlSessions) {
		return nil
	}
	result, err := s.Store.TerminateTenantSession(r.Context(), r.PathValue("sessionId"), claims.TenantID, claims.UserID, requestIP(r))
	if err != nil {
		switch {
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

func (s Service) HandlePause(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if !s.authorized(w, r, claims, tenantauth.CanControlSessions) {
		return nil
	}
	result, err := s.Store.PauseTenantSession(r.Context(), r.PathValue("sessionId"), claims.TenantID, claims.UserID, requestIP(r))
	if err != nil {
		s.writeLifecycleError(w, err)
		return nil
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"sessionId": result.ID,
		"protocol":  result.Protocol,
		"status":    result.Status,
		"paused":    result.Status == sessions.SessionStatusPaused,
	})
	return nil
}

func (s Service) HandleResume(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if !s.authorized(w, r, claims, tenantauth.CanControlSessions) {
		return nil
	}
	result, err := s.Store.ResumeTenantSession(r.Context(), r.PathValue("sessionId"), claims.TenantID, claims.UserID, requestIP(r))
	if err != nil {
		s.writeLifecycleError(w, err)
		return nil
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"ok":        true,
		"sessionId": result.ID,
		"protocol":  result.Protocol,
		"status":    result.Status,
		"paused":    result.Status == sessions.SessionStatusPaused,
	})
	return nil
}

func (s Service) writeLifecycleError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, sessions.ErrSessionNotFound):
		app.ErrorJSON(w, http.StatusNotFound, "Session not found")
	case errors.Is(err, sessions.ErrSessionClosed):
		app.ErrorJSON(w, http.StatusConflict, "Session already closed")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func (s Service) authorized(w http.ResponseWriter, r *http.Request, claims authn.Claims, required tenantauth.PermissionFlag) bool {
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

	if !membership.Permissions[required] {
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
