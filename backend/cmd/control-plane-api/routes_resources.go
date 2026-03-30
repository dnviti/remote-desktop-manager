package main

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/dnviti/arsenale/backend/internal/importexportapi"
	"github.com/dnviti/arsenale/backend/internal/syncprofiles"
)

func (d *apiDependencies) registerResourceRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/checkouts", d.authenticator.Middleware(d.checkoutService.HandleList))
	mux.HandleFunc("POST /api/checkouts", d.authenticator.Middleware(d.checkoutService.HandleCreate))
	mux.HandleFunc("GET /api/checkouts/{id}", d.authenticator.Middleware(d.checkoutService.HandleGet))
	mux.HandleFunc("POST /api/checkouts/{id}/approve", d.authenticator.Middleware(d.checkoutService.HandleApprove))
	mux.HandleFunc("POST /api/checkouts/{id}/reject", d.authenticator.Middleware(d.checkoutService.HandleReject))
	mux.HandleFunc("POST /api/checkouts/{id}/checkin", d.authenticator.Middleware(d.checkoutService.HandleCheckin))

	mux.HandleFunc("GET /api/connections", d.authenticator.Middleware(d.connectionService.HandleList))
	mux.HandleFunc("POST /api/connections/export", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.importExportService.HandleExport(w, r, claims); err != nil {
			if errors.Is(err, importexportapi.ErrLegacyImportExportFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/connections/import", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.importExportService.HandleImport(w, r, claims); err != nil {
			if errors.Is(err, importexportapi.ErrLegacyImportExportFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/connections", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.connectionService.HandleCreate(w, r, claims); err != nil {
			if errors.Is(err, connections.ErrLegacyConnectionFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("GET /api/connections/{id}", d.authenticator.Middleware(d.connectionService.HandleGetOne))
	mux.HandleFunc("POST /api/connections/batch-share", d.authenticator.Middleware(d.connectionService.HandleBatchShare))
	mux.HandleFunc("POST /api/connections/{id}/share", d.authenticator.Middleware(d.connectionService.HandleShare))
	mux.HandleFunc("PUT /api/connections/{id}/share/{userId}", d.authenticator.Middleware(d.connectionService.HandleUpdateSharePermission))
	mux.HandleFunc("DELETE /api/connections/{id}/share/{userId}", d.authenticator.Middleware(d.connectionService.HandleUnshare))
	mux.HandleFunc("GET /api/connections/{id}/shares", d.authenticator.Middleware(d.connectionService.HandleListShares))
	mux.HandleFunc("PUT /api/connections/{id}", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.connectionService.HandleUpdate(w, r, claims); err != nil {
			if errors.Is(err, connections.ErrLegacyConnectionFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("DELETE /api/connections/{id}", d.authenticator.Middleware(d.connectionService.HandleDelete))
	mux.HandleFunc("PATCH /api/connections/{id}/favorite", d.authenticator.Middleware(d.connectionService.HandleToggleFavorite))
	mux.HandleFunc("GET /api/cli/connections", d.authenticator.Middleware(d.connectionService.HandleCLIList))

	mux.HandleFunc("GET /api/folders", d.authenticator.Middleware(d.folderService.HandleList))
	mux.HandleFunc("POST /api/folders", d.authenticator.Middleware(d.folderService.HandleCreate))
	mux.HandleFunc("PUT /api/folders/{id}", d.authenticator.Middleware(d.folderService.HandleUpdate))
	mux.HandleFunc("DELETE /api/folders/{id}", d.authenticator.Middleware(d.folderService.HandleDelete))

	mux.HandleFunc("/api/vault-folders", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			d.authenticator.Middleware(d.vaultFolderService.HandleList)(w, r)
		case http.MethodPost:
			d.authenticator.Middleware(d.vaultFolderService.HandleCreate)(w, r)
		default:
			w.Header().Set("Allow", "GET, POST")
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
	mux.HandleFunc("/api/vault-folders/", func(w http.ResponseWriter, r *http.Request) {
		id := strings.TrimPrefix(r.URL.Path, "/api/vault-folders/")
		if id == "" || strings.Contains(id, "/") {
			http.NotFound(w, r)
			return
		}
		r.SetPathValue("id", id)
		switch r.Method {
		case http.MethodPut:
			d.authenticator.Middleware(d.vaultFolderService.HandleUpdate)(w, r)
		case http.MethodDelete:
			d.authenticator.Middleware(d.vaultFolderService.HandleDelete)(w, r)
		default:
			w.Header().Set("Allow", "PUT, DELETE")
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})

	mux.HandleFunc("GET /api/files", d.authenticator.Middleware(d.fileService.HandleList))
	mux.HandleFunc("POST /api/files", d.authenticator.Middleware(d.fileService.HandleUpload))
	mux.HandleFunc("GET /api/files/{name}", d.authenticator.Middleware(d.fileService.HandleDownload))
	mux.HandleFunc("DELETE /api/files/{name}", d.authenticator.Middleware(d.fileService.HandleDelete))

	mux.HandleFunc("GET /api/vault-providers", d.authenticator.Middleware(d.externalVaultService.HandleList))
	mux.HandleFunc("POST /api/vault-providers", d.authenticator.Middleware(d.externalVaultService.HandleCreate))
	mux.HandleFunc("GET /api/vault-providers/{providerId}", d.authenticator.Middleware(d.externalVaultService.HandleGet))
	mux.HandleFunc("PUT /api/vault-providers/{providerId}", d.authenticator.Middleware(d.externalVaultService.HandleUpdate))
	mux.HandleFunc("DELETE /api/vault-providers/{providerId}", d.authenticator.Middleware(d.externalVaultService.HandleDelete))
	mux.HandleFunc("POST /api/vault-providers/{providerId}/test", d.authenticator.Middleware(d.externalVaultService.HandleTest))

	mux.HandleFunc("GET /api/sync-profiles", d.authenticator.Middleware(d.syncProfileService.HandleList))
	mux.HandleFunc("POST /api/sync-profiles", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.syncProfileService.HandleCreate(w, r, claims); err != nil {
			if errors.Is(err, syncprofiles.ErrLegacySyncProfileFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("GET /api/sync-profiles/{id}", d.authenticator.Middleware(d.syncProfileService.HandleGet))
	mux.HandleFunc("PUT /api/sync-profiles/{id}", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.syncProfileService.HandleUpdate(w, r, claims); err != nil {
			if errors.Is(err, syncprofiles.ErrLegacySyncProfileFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("DELETE /api/sync-profiles/{id}", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.syncProfileService.HandleDelete(w, r, claims); err != nil {
			if errors.Is(err, syncprofiles.ErrLegacySyncProfileFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/sync-profiles/{id}/test", d.authenticator.Middleware(d.syncProfileService.HandleTestConnection))
	mux.HandleFunc("POST /api/sync-profiles/{id}/sync", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.syncProfileService.HandleTriggerSync(w, r, claims); err != nil {
			if errors.Is(err, syncprofiles.ErrLegacySyncProfileFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("GET /api/sync-profiles/{id}/logs", d.authenticator.Middleware(d.syncProfileService.HandleLogs))

	mux.HandleFunc("/api/teams", func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet:
			d.authenticator.Middleware(d.teamService.HandleList)(w, r)
		case http.MethodPost:
			d.authenticator.Middleware(d.teamService.HandleCreate)(w, r)
		default:
			w.Header().Set("Allow", "GET, POST")
			app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		}
	})
	mux.HandleFunc("/api/teams/", func(w http.ResponseWriter, r *http.Request) {
		path := strings.TrimPrefix(r.URL.Path, "/api/teams/")
		parts := strings.Split(path, "/")
		switch {
		case len(parts) == 1 && parts[0] != "":
			r.SetPathValue("id", parts[0])
			switch r.Method {
			case http.MethodGet:
				d.authenticator.Middleware(d.teamService.HandleGet)(w, r)
			case http.MethodPut:
				d.authenticator.Middleware(d.teamService.HandleUpdate)(w, r)
			case http.MethodDelete:
				d.authenticator.Middleware(d.teamService.HandleDelete)(w, r)
			default:
				w.Header().Set("Allow", "GET, PUT, DELETE")
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			}
		case len(parts) == 2 && parts[0] != "" && parts[1] == "members":
			r.SetPathValue("id", parts[0])
			switch r.Method {
			case http.MethodGet:
				d.authenticator.Middleware(d.teamService.HandleListMembers)(w, r)
			case http.MethodPost:
				d.authenticator.Middleware(d.teamService.HandleAddMember)(w, r)
			default:
				w.Header().Set("Allow", "GET, POST")
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			}
		case len(parts) == 3 && parts[0] != "" && parts[1] == "members" && parts[2] != "":
			r.SetPathValue("id", parts[0])
			r.SetPathValue("userId", parts[2])
			switch r.Method {
			case http.MethodPut:
				d.authenticator.Middleware(d.teamService.HandleUpdateMemberRole)(w, r)
			case http.MethodDelete:
				d.authenticator.Middleware(d.teamService.HandleRemoveMember)(w, r)
			default:
				w.Header().Set("Allow", "PUT, DELETE")
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
			}
		case len(parts) == 4 && parts[0] != "" && parts[1] == "members" && parts[2] != "" && parts[3] == "expiry":
			r.SetPathValue("id", parts[0])
			r.SetPathValue("userId", parts[2])
			if r.Method != http.MethodPatch {
				w.Header().Set("Allow", http.MethodPatch)
				app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
				return
			}
			d.authenticator.Middleware(d.teamService.HandleUpdateMemberExpiry)(w, r)
		default:
			http.NotFound(w, r)
		}
	})
}
