package connections

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleShare(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	payload, err := parseSharePayload(r)
	if err != nil {
		writeConnectionError(w, err)
		return
	}

	result, err := s.ShareConnection(r.Context(), claims, r.PathValue("id"), shareTarget{
		Email:  payload.Email,
		UserID: payload.UserID,
	}, payload.Permission, requestIP(r))
	if err != nil {
		writeConnectionError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleBatchShare(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	payload, err := parseBatchSharePayload(r)
	if err != nil {
		writeConnectionError(w, err)
		return
	}

	result, err := s.BatchShareConnections(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		writeConnectionError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUnshare(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.UnshareConnection(r.Context(), claims, r.PathValue("id"), r.PathValue("userId"), requestIP(r)); err != nil {
		writeConnectionError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) HandleUpdateSharePermission(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	payload, err := parseUpdateSharePermissionPayload(r)
	if err != nil {
		writeConnectionError(w, err)
		return
	}

	result, err := s.UpdateSharePermission(r.Context(), claims, r.PathValue("id"), r.PathValue("userId"), payload.Permission, requestIP(r))
	if err != nil {
		writeConnectionError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListShares(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ListShares(r.Context(), claims, r.PathValue("id"))
	if err != nil {
		writeConnectionError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func writeConnectionError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
		return
	}
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
