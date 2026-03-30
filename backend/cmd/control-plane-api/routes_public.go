package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (d *apiDependencies) registerPublicRoutes(mux *http.ServeMux) {
	mux.Handle("/api/health", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		app.WriteJSON(w, http.StatusOK, map[string]any{
			"status":  "ok",
			"service": "control-plane-api",
		})
	}))
	mux.Handle("/api/ready", http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			return
		}
		readiness := checkAPIReadiness(r.Context(), d.db, d.legacyAPIProbe)
		statusCode := http.StatusOK
		if readiness.Status != "ok" {
			statusCode = http.StatusServiceUnavailable
		}
		app.WriteJSON(w, statusCode, readiness)
	}))

	mux.HandleFunc("GET /api/share/{token}/info", d.publicShareService.HandleGetInfo)
	mux.HandleFunc("POST /api/share/{token}", d.publicShareService.HandleAccess)
	mux.HandleFunc("GET /api/setup/status", d.setupService.HandleStatus)
	mux.HandleFunc("GET /api/setup/db-status", d.setupService.HandleDBStatus)
	mux.HandleFunc("POST /api/setup/complete", d.setupService.HandleComplete)
	mux.HandleFunc("POST /api/cli/auth/device", d.cliService.HandleInitiateDeviceAuth)
	mux.HandleFunc("POST /api/cli/auth/device/token", d.cliService.HandlePollDeviceToken)
	mux.HandleFunc("POST /api/cli/auth/device/authorize", d.authenticator.Middleware(d.cliService.HandleAuthorizeDevice))
}
