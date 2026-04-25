package authservice

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleActivityTouch(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	ttl, err := s.browserSessionTTLForUserID(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	sessionID := ""
	if cookie, cookieErr := r.Cookie(s.browserSessionCookieName()); cookieErr == nil && cookie.Value != "" {
		sessionID = cookie.Value
	}

	sessionID, err = s.TouchBrowserSession(r.Context(), sessionID, claims.UserID, ttl)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if sessionID != "" {
		s.setBrowserSessionCookie(w, sessionID, ttl)
	}
	_ = s.ensureCSRFCookie(w, r, ttl)

	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
