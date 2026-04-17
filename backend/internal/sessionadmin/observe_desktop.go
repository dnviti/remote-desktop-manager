package sessionadmin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type DesktopObserveGrantResponse struct {
	SessionID     string    `json:"sessionId"`
	Protocol      string    `json:"protocol"`
	Token         string    `json:"token"`
	ExpiresAt     time.Time `json:"expiresAt"`
	WebSocketPath string    `json:"webSocketPath"`
	WebSocketURL  string    `json:"webSocketUrl,omitempty"`
	ReadOnly      bool      `json:"readOnly"`
}

type desktopObserverGrantIssuer interface {
	IssueDesktopObserverGrant(ctx context.Context, target sessions.TenantSessionSummary, observerUserID string, request *http.Request) (DesktopObserveGrantResponse, error)
}

func (s Service) HandleObserveRDP(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	s.handleObserveDesktop(w, r, claims, "RDP")
}

func (s Service) HandleObserveVNC(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	s.handleObserveDesktop(w, r, claims, "VNC")
}

func (s Service) handleObserveDesktop(w http.ResponseWriter, r *http.Request, claims authn.Claims, protocol string) {
	if !s.authorized(w, r, claims, tenantauth.CanObserveSessions) {
		return
	}
	if s.DesktopObserverGrants == nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, "Desktop observer grants are unavailable")
		return
	}

	sessionID := strings.TrimSpace(r.PathValue("sessionId"))
	if sessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sessionId is required")
		return
	}

	target, err := s.Store.LoadTenantSessionSummary(r.Context(), sessionID, claims.TenantID)
	if err != nil {
		s.writeObserveError(w, err)
		return
	}
	if target == nil {
		app.ErrorJSON(w, http.StatusNotFound, "Session not found")
		return
	}
	if target.Protocol != protocol {
		app.ErrorJSON(w, http.StatusBadRequest, "Only "+protocol+" sessions can be observed")
		return
	}
	if target.Status == sessions.SessionStatusClosed {
		app.ErrorJSON(w, http.StatusConflict, "Session already closed")
		return
	}
	if strings.TrimSpace(target.GuacdConnectionID) == "" {
		app.ErrorJSON(w, http.StatusConflict, "Desktop session is not ready for observation yet")
		return
	}

	response, err := s.DesktopObserverGrants.IssueDesktopObserverGrant(r.Context(), *target, claims.UserID, r)
	if err != nil {
		s.writeObserveError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, response)
}
