package vaultfolders

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureKeychainEnabled(); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	result, err := s.ListFolders(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureKeychainEnabled(); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.CreateFolder(r.Context(), claims, payload)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureKeychainEnabled(); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.UpdateFolder(r.Context(), claims, r.PathValue("id"), payload)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureKeychainEnabled(); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.DeleteFolder(r.Context(), claims, r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}
