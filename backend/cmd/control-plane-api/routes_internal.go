package main

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/internal/orchestration"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5"
)

func (d *apiDependencies) registerInternalRoutes(mux *http.ServeMux) {
	mux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api" || strings.HasPrefix(r.URL.Path, "/api/") {
			d.legacyAPIProxy.ServeHTTP(w, r)
			return
		}
		http.NotFound(w, r)
	})

	mux.HandleFunc("GET /v1/services", func(w http.ResponseWriter, _ *http.Request) {
		app.WriteJSON(w, http.StatusOK, map[string]any{"services": catalog.Services()})
	})
	mux.HandleFunc("GET /v1/capabilities", func(w http.ResponseWriter, _ *http.Request) {
		app.WriteJSON(w, http.StatusOK, map[string]any{"capabilities": catalog.Capabilities()})
	})
	mux.HandleFunc("POST /v1/orchestrators:validate", func(w http.ResponseWriter, r *http.Request) {
		var conn contracts.OrchestratorConnection
		if err := app.ReadJSON(r, &conn); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		app.WriteJSON(w, http.StatusOK, orchestration.ValidateConnection(conn))
	})
	mux.HandleFunc("GET /v1/orchestrators", func(w http.ResponseWriter, r *http.Request) {
		connections, err := d.store.ListConnections(r.Context())
		if err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			return
		}
		app.WriteJSON(w, http.StatusOK, map[string]any{"connections": connections})
	})
	mux.HandleFunc("GET /v1/orchestrators/{name}", func(w http.ResponseWriter, r *http.Request) {
		connection, err := d.store.GetConnection(r.Context(), r.PathValue("name"))
		if err != nil {
			switch {
			case errors.Is(err, pgx.ErrNoRows):
				app.ErrorJSON(w, http.StatusNotFound, "orchestrator connection not found")
			default:
				app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			}
			return
		}
		app.WriteJSON(w, http.StatusOK, map[string]any{"connection": connection})
	})
	mux.HandleFunc("PUT /v1/orchestrators/{name}", func(w http.ResponseWriter, r *http.Request) {
		var conn contracts.OrchestratorConnection
		if err := app.ReadJSON(r, &conn); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		name := r.PathValue("name")
		if conn.Name != "" && conn.Name != name {
			app.ErrorJSON(w, http.StatusBadRequest, "connection name must match the URL path")
			return
		}
		conn.Name = name

		validation := orchestration.ValidateConnection(conn)
		if !validation.Valid {
			app.WriteJSON(w, http.StatusBadRequest, validation)
			return
		}

		stored, err := d.store.UpsertConnection(r.Context(), conn)
		if err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			return
		}

		app.WriteJSON(w, http.StatusOK, map[string]any{
			"connection": stored,
			"validation": validation,
		})
	})

	mux.HandleFunc("POST /v1/desktop/session-grants:issue", d.desktopSessionService.HandleIssue)
	mux.HandleFunc("POST /v1/desktop/sessions/{sessionId}/heartbeat", d.desktopSessionService.HandleHeartbeat)
	mux.HandleFunc("POST /v1/desktop/sessions/{sessionId}/end", d.desktopSessionService.HandleEnd)
	mux.HandleFunc("POST /v1/database/sessions:issue", d.databaseSessionService.HandleIssue)
	mux.HandleFunc("POST /v1/database/sessions/{sessionId}/heartbeat", d.databaseSessionService.HandleHeartbeat)
	mux.HandleFunc("POST /v1/database/sessions/{sessionId}/end", d.databaseSessionService.HandleEnd)
	mux.HandleFunc("POST /v1/database/sessions/{sessionId}/config", d.databaseSessionService.HandleConfigUpdate)
	mux.HandleFunc("GET /v1/database/sessions/{sessionId}/config", d.databaseSessionService.HandleConfigGet)
}
