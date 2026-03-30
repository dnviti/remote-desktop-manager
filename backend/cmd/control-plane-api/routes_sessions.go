package main

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/sshsessions"
)

func (d *apiDependencies) handleOwnedSessionHeartbeat(w http.ResponseWriter, r *http.Request, userID string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if err := d.sessionStore.HeartbeatOwnedSession(r.Context(), r.PathValue("sessionId"), userID); err != nil {
		switch {
		case errors.Is(err, sessions.ErrSessionNotFound):
			app.ErrorJSON(w, http.StatusNotFound, "session not found")
		case errors.Is(err, sessions.ErrSessionClosed):
			app.ErrorJSON(w, http.StatusGone, "session already closed")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (d *apiDependencies) handleOwnedSessionEnd(w http.ResponseWriter, r *http.Request, userID, reason string) {
	if strings.TrimSpace(userID) == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
		return
	}
	if strings.TrimSpace(reason) == "" {
		reason = "client_disconnect"
	}
	if err := d.sessionStore.EndOwnedSession(r.Context(), r.PathValue("sessionId"), userID, strings.TrimSpace(reason)); err != nil {
		switch {
		case errors.Is(err, sessions.ErrSessionNotFound):
			app.ErrorJSON(w, http.StatusNotFound, "session not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (d *apiDependencies) registerSessionRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/sessions/active", d.authenticator.Middleware(d.sessionAdminService.HandleList))
	mux.HandleFunc("GET /api/sessions/count", d.authenticator.Middleware(d.sessionAdminService.HandleCount))
	mux.HandleFunc("GET /api/sessions/count/gateway", d.authenticator.Middleware(d.sessionAdminService.HandleCountByGateway))
	mux.HandleFunc("POST /api/sessions/ssh", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.sshSessionService.HandleCreate(w, r, claims); err != nil {
			if errors.Is(err, sshsessions.ErrLegacySSHSessionFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/sessions/rdp/{sessionId}/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.handleOwnedSessionHeartbeat(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/sessions/rdp/{sessionId}/end", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.handleOwnedSessionEnd(w, r, claims.UserID, "client_disconnect")
	})
	mux.HandleFunc("POST /api/sessions/vnc/{sessionId}/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.handleOwnedSessionHeartbeat(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/sessions/vnc/{sessionId}/end", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.handleOwnedSessionEnd(w, r, claims.UserID, "client_disconnect")
	})
	mux.HandleFunc("POST /api/sessions/ssh/{sessionId}/end", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.handleOwnedSessionEnd(w, r, claims.UserID, "client_disconnect")
	})
	mux.HandleFunc("POST /api/sessions/database/{sessionId}/heartbeat", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.databaseSessionService.HandleOwnedHeartbeat(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/sessions/database/{sessionId}/end", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.databaseSessionService.HandleOwnedEnd(w, r, claims.UserID, "client_disconnect")
	})
	mux.HandleFunc("PUT /api/sessions/database/{sessionId}/config", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.databaseSessionService.HandleOwnedConfigUpdate(w, r, claims.UserID)
	})
	mux.HandleFunc("GET /api/sessions/database/{sessionId}/config", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.databaseSessionService.HandleOwnedConfigGet(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/sessions/{sessionId}/terminate", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.sessionAdminService.HandleTerminate(w, r, claims); err != nil {
			if errors.Is(err, sessions.ErrLegacySessionAdminFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/sessions/ssh-proxy/token", d.authenticator.Middleware(d.sshProxyService.HandleCreateToken))
	mux.HandleFunc("GET /api/sessions/ssh-proxy/status", d.authenticator.Middleware(d.sshProxyService.HandleStatus))
	mux.HandleFunc("GET /api/sessions/database/{sessionId}/history", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.databaseSessionService.HandleHistory(w, r, claims.UserID)
	})
}
