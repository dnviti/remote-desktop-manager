package dbauditapi

import (
	"database/sql"
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleListLogs(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	query, err := parseDBAuditQuery(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.ListLogs(r.Context(), claims.TenantID, query)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListConnections(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	items, err := s.ListConnections(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleListUsers(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	items, err := s.ListUsers(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleListFirewallRules(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	items, err := s.ListFirewallRules(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGetFirewallRule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	item, err := s.GetFirewallRule(r.Context(), claims.TenantID, r.PathValue("ruleId"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Firewall rule not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleListMaskingPolicies(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	items, err := s.ListMaskingPolicies(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGetMaskingPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	item, err := s.GetMaskingPolicy(r.Context(), claims.TenantID, r.PathValue("policyId"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Masking policy not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleListRateLimitPolicies(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	items, err := s.ListRateLimitPolicies(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGetRateLimitPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorized(w, r, claims) {
		return
	}
	item, err := s.GetRateLimitPolicy(r.Context(), claims.TenantID, r.PathValue("policyId"))
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Rate limit policy not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleCreateFirewallRule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	var payload struct {
		Name        string  `json:"name"`
		Pattern     string  `json:"pattern"`
		Action      string  `json:"action"`
		Scope       *string `json:"scope"`
		Description *string `json:"description"`
		Enabled     *bool   `json:"enabled"`
		Priority    *int    `json:"priority"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.CreateFirewallRule(r.Context(), claims, payload.Name, payload.Pattern, payload.Action, payload.Scope, payload.Description, payload.Enabled, payload.Priority, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, item)
}

func (s Service) HandleUpdateFirewallRule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	payload, err := readRawUpdatePayload(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.UpdateFirewallRule(r.Context(), claims, r.PathValue("ruleId"), payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleDeleteFirewallRule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	if err := s.DeleteFirewallRule(r.Context(), claims, r.PathValue("ruleId"), requestIP(r)); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleCreateMaskingPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	var payload struct {
		Name          string   `json:"name"`
		ColumnPattern string   `json:"columnPattern"`
		Strategy      string   `json:"strategy"`
		ExemptRoles   []string `json:"exemptRoles"`
		Scope         *string  `json:"scope"`
		Description   *string  `json:"description"`
		Enabled       *bool    `json:"enabled"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.CreateMaskingPolicy(r.Context(), claims, payload.Name, payload.ColumnPattern, payload.Strategy, payload.ExemptRoles, payload.Scope, payload.Description, payload.Enabled, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, item)
}

func (s Service) HandleUpdateMaskingPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	payload, err := readRawUpdatePayload(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.UpdateMaskingPolicy(r.Context(), claims, r.PathValue("policyId"), payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleDeleteMaskingPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	if err := s.DeleteMaskingPolicy(r.Context(), claims, r.PathValue("policyId"), requestIP(r)); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s Service) HandleCreateRateLimitPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	var payload struct {
		Name        string   `json:"name"`
		QueryType   *string  `json:"queryType"`
		WindowMS    *int     `json:"windowMs"`
		MaxQueries  *int     `json:"maxQueries"`
		BurstMax    *int     `json:"burstMax"`
		ExemptRoles []string `json:"exemptRoles"`
		Scope       *string  `json:"scope"`
		Action      *string  `json:"action"`
		Enabled     *bool    `json:"enabled"`
		Priority    *int     `json:"priority"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.CreateRateLimitPolicy(r.Context(), claims, payload.Name, payload.QueryType, payload.WindowMS, payload.MaxQueries, payload.BurstMax, payload.ExemptRoles, payload.Scope, payload.Action, payload.Enabled, payload.Priority, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusCreated, item)
}

func (s Service) HandleUpdateRateLimitPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	payload, err := readRawUpdatePayload(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	item, err := s.UpdateRateLimitPolicy(r.Context(), claims, r.PathValue("policyId"), payload, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, item)
}

func (s Service) HandleDeleteRateLimitPolicy(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !s.authorizedWrite(w, r, claims) {
		return
	}
	if err := s.DeleteRateLimitPolicy(r.Context(), claims, r.PathValue("policyId"), requestIP(r)); err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}
