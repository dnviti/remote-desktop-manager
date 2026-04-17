package recordingsapi

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	query, err := parseListQuery(r)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.ListRecordings(r.Context(), claims, query)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, "RECORDING_VIEW", item.ID, map[string]any{
		"recordingId":  item.ID,
		"protocol":     item.Protocol,
		"connectionId": item.ConnectionID,
	}, requestIP(r))
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleAuditTrail(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetAuditTrail(r.Context(), r.PathValue("id"), claims)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
			return
		}
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	deleted, err := s.DeleteRecording(r.Context(), r.PathValue("id"), claims)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !deleted {
		app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, "RECORDING_DELETE", r.PathValue("id"), map[string]any{
		"recordingId": r.PathValue("id"),
	}, requestIP(r))
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
