package gateways

import (
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.ListGateways(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanManageGateways(claims.TenantRole) {
		app.ErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
		return
	}
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.CreateGateway(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanManageGateways(claims.TenantRole) {
		app.ErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
		return
	}
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.UpdateGateway(r.Context(), claims, r.PathValue("id"), payload, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanManageGateways(claims.TenantRole) {
		app.ErrorJSON(w, http.StatusForbidden, "Insufficient permissions")
		return
	}
	force := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("force")), "true")
	result, err := s.DeleteGateway(r.Context(), claims, r.PathValue("id"), force, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleTestConnectivity(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.TestGatewayConnectivity(r.Context(), claims.TenantID, r.PathValue("id"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func claimsCanManageGateways(role string) bool {
	switch strings.ToUpper(strings.TrimSpace(role)) {
	case "OWNER", "ADMIN", "OPERATOR":
		return true
	default:
		return false
	}
}
