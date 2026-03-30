package teams

import (
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload createTeamPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.CreateTeam(r.Context(), claims.TenantID, claims.UserID, payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	result, err := s.ListUserTeams(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	result, err := s.GetTeam(r.Context(), r.PathValue("id"), claims.UserID, claims.TenantID)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListMembers(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	result, err := s.ListMembers(r.Context(), r.PathValue("id"), claims.UserID, claims.TenantID)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload updateTeamPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateTeam(r.Context(), r.PathValue("id"), claims.UserID, claims.TenantID, payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleAddMember(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload addMemberPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.AddMember(
		r.Context(),
		r.PathValue("id"),
		strings.TrimSpace(payload.UserID),
		strings.TrimSpace(payload.Role),
		payload.ExpiresAt.Value,
		claims.UserID,
		claims.TenantID,
		requestIP(r),
	)
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	result, err := s.DeleteTeam(r.Context(), r.PathValue("id"), claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdateMemberRole(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload updateMemberRolePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateMemberRole(r.Context(), r.PathValue("id"), r.PathValue("userId"), strings.TrimSpace(payload.Role), claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRemoveMember(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	result, err := s.RemoveMember(r.Context(), r.PathValue("id"), r.PathValue("userId"), claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdateMemberExpiry(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantMembership(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload updateMemberExpiryPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if !payload.ExpiresAt.Present {
		app.ErrorJSON(w, http.StatusBadRequest, "expiresAt is required")
		return
	}

	result, err := s.UpdateMemberExpiry(r.Context(), r.PathValue("id"), r.PathValue("userId"), payload.ExpiresAt.Value, claims.UserID, claims.TenantID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}
