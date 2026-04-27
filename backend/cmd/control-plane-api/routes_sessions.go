package main

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/dnviti/arsenale/backend/internal/sessions"
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
	connectionsEnabled := d.features.HasFeature(runtimefeatures.FeatureConnections)
	databasesEnabled := d.features.HasFeature(runtimefeatures.FeatureDatabases)

	mux.HandleFunc("GET /api/sessions/active", d.authenticator.Middleware(d.sessionAdminService.HandleList))
	mux.HandleFunc("GET /api/sessions/console", d.authenticator.Middleware(d.sessionAdminService.HandleSessionConsole))
	mux.HandleFunc("GET /api/sessions/count", d.authenticator.Middleware(d.sessionAdminService.HandleCount))
	mux.HandleFunc("GET /api/sessions/count/gateway", d.authenticator.Middleware(d.sessionAdminService.HandleCountByGateway))
	if connectionsEnabled {
		mux.HandleFunc("POST /api/sessions/ssh", d.authenticatedError(d.sshSessionService.HandleCreate))
		mux.HandleFunc("POST /api/sessions/ssh/{sessionId}/observe", d.authenticator.Middleware(d.sessionAdminService.HandleObserveSSH))
		mux.HandleFunc("POST /api/sessions/rdp", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.desktopSessionService.HandleCreateRDP(w, r, claims)
		}))
		mux.HandleFunc("POST /api/sessions/rdp/{sessionId}/observe", d.authenticator.Middleware(d.sessionAdminService.HandleObserveRDP))
		mux.HandleFunc("POST /api/sessions/vnc", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.desktopSessionService.HandleCreateVNC(w, r, claims)
		}))
		mux.HandleFunc("POST /api/sessions/vnc/{sessionId}/observe", d.authenticator.Middleware(d.sessionAdminService.HandleObserveVNC))
		mux.HandleFunc("POST /api/sessions/rdp/{sessionId}/heartbeat", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.handleOwnedSessionHeartbeat(w, r, userID)
		}))
		mux.HandleFunc("POST /api/sessions/rdp/{sessionId}/end", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.handleOwnedSessionEnd(w, r, userID, "client_disconnect")
		}))
		mux.HandleFunc("POST /api/sessions/vnc/{sessionId}/heartbeat", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.handleOwnedSessionHeartbeat(w, r, userID)
		}))
		mux.HandleFunc("POST /api/sessions/vnc/{sessionId}/end", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.handleOwnedSessionEnd(w, r, userID, "client_disconnect")
		}))
		mux.HandleFunc("POST /api/sessions/ssh/{sessionId}/end", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.handleOwnedSessionEnd(w, r, userID, "client_disconnect")
		}))
	}
	if databasesEnabled {
		mux.HandleFunc("POST /api/sessions/database", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.databaseSessionService.HandleCreate(w, r, claims)
		}))
		mux.HandleFunc("POST /api/sessions/database/{sessionId}/heartbeat", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.databaseSessionService.HandleOwnedHeartbeat(w, r, userID)
		}))
		mux.HandleFunc("POST /api/sessions/database/{sessionId}/end", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.databaseSessionService.HandleOwnedEnd(w, r, userID, "client_disconnect")
		}))
		mux.HandleFunc("PUT /api/sessions/database/{sessionId}/config", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.databaseSessionService.HandleOwnedConfigUpdate(w, r, userID)
		}))
		mux.HandleFunc("GET /api/sessions/database/{sessionId}/config", d.authenticatedUserID(func(w http.ResponseWriter, r *http.Request, userID string) {
			d.databaseSessionService.HandleOwnedConfigGet(w, r, userID)
		}))
		mux.HandleFunc("POST /api/sessions/database/{sessionId}/query", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.databaseSessionService.HandleOwnedQuery(w, r, claims.UserID, claims.TenantID, claims.TenantRole, sessionRequestIP(r))
		}))
		mux.HandleFunc("GET /api/sessions/database/{sessionId}/schema", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.databaseSessionService.HandleOwnedSchema(w, r, claims.UserID, claims.TenantID)
		}))
		mux.HandleFunc("POST /api/sessions/database/{sessionId}/explain", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.databaseSessionService.HandleOwnedExplain(w, r, claims.UserID, claims.TenantID, claims.TenantRole, sessionRequestIP(r))
		}))
		mux.HandleFunc("POST /api/sessions/database/{sessionId}/introspect", d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
			d.databaseSessionService.HandleOwnedIntrospect(w, r, claims.UserID, claims.TenantID)
		}))
	}
	if connectionsEnabled && databasesEnabled {
		mux.HandleFunc("POST /api/sessions/db-tunnel", d.authenticator.Middleware(d.sshSessionService.HandleCreateDBTunnel))
		mux.HandleFunc("GET /api/sessions/db-tunnel", d.authenticator.Middleware(d.sshSessionService.HandleListDBTunnels))
		mux.HandleFunc("POST /api/sessions/db-tunnel/{tunnelId}/heartbeat", d.authenticator.Middleware(d.sshSessionService.HandleDBTunnelHeartbeat))
		mux.HandleFunc("DELETE /api/sessions/db-tunnel/{tunnelId}", d.authenticator.Middleware(d.sshSessionService.HandleCloseDBTunnel))
	}
	mux.HandleFunc("POST /api/sessions/{sessionId}/terminate", d.authenticatedError(d.sessionAdminService.HandleTerminate))
	mux.HandleFunc("POST /api/sessions/{sessionId}/pause", d.authenticatedError(d.sessionAdminService.HandlePause))
	mux.HandleFunc("POST /api/sessions/{sessionId}/resume", d.authenticatedError(d.sessionAdminService.HandleResume))
	if connectionsEnabled {
		mux.HandleFunc("POST /api/sessions/ssh-proxy/token", d.authenticator.Middleware(d.sshProxyService.HandleCreateToken))
		mux.HandleFunc("GET /api/sessions/ssh-proxy/status", d.authenticator.Middleware(d.sshProxyService.HandleStatus))
	}
	if databasesEnabled {
		mux.HandleFunc("GET /api/sessions/database/{sessionId}/history", d.authenticatedUserID(d.databaseSessionService.HandleHistory))
	}
}

func sessionRequestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedHeader(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if host, _, err := net.SplitHostPort(value); err == nil {
			value = host
		}
		value = strings.TrimPrefix(value, "::ffff:")
		if value != "" {
			return value
		}
	}
	return ""
}

func firstForwardedHeader(value string) string {
	parts := strings.Split(value, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}
