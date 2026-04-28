package gateways

import (
	"encoding/json"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleGetEgressPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !requireGatewayManager(w, claims) {
		return
	}
	policy, err := s.GetGatewayEgressPolicy(r.Context(), claims.TenantID, r.PathValue("id"))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, json.RawMessage(policy))
}

func (s Service) HandleUpdateEgressPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !requireGatewayManager(w, claims) {
		return
	}
	var raw json.RawMessage
	if err := app.ReadJSON(r, &raw); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.UpdateGatewayEgressPolicy(r.Context(), claims, r.PathValue("id"), raw, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleTestEgressPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !requireGatewayManager(w, claims) {
		return
	}
	var payload egressPolicyTestPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.TestGatewayEgressPolicy(r.Context(), claims, r.PathValue("id"), payload)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}
