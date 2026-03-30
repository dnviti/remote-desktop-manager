package checkouts

import (
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if role == "" {
		role = "all"
	}
	if role != "all" && role != "requester" && role != "approver" {
		app.ErrorJSON(w, http.StatusBadRequest, "role must be one of requester, approver, all")
		return
	}

	status := strings.TrimSpace(r.URL.Query().Get("status"))
	if status != "" && !isValidStatus(status) {
		app.ErrorJSON(w, http.StatusBadRequest, "status must be one of PENDING, APPROVED, REJECTED, EXPIRED, CHECKED_IN")
		return
	}

	limit, err := parseIntQuery(r.URL.Query().Get("limit"), 50)
	if err != nil || limit < 1 || limit > 100 {
		app.ErrorJSON(w, http.StatusBadRequest, "limit must be between 1 and 100")
		return
	}
	offset, err := parseIntQuery(r.URL.Query().Get("offset"), 0)
	if err != nil || offset < 0 {
		app.ErrorJSON(w, http.StatusBadRequest, "offset must be a non-negative integer")
		return
	}

	result, err := s.List(r.Context(), claims.UserID, role, status, limit, offset)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.Create(r.Context(), claims.UserID, payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.Get(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleApprove(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.Approve(r.Context(), r.PathValue("id"), claims.UserID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleReject(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.Reject(r.Context(), r.PathValue("id"), claims.UserID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCheckin(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.Checkin(r.Context(), r.PathValue("id"), claims.UserID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}
