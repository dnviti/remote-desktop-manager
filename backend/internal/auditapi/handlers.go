package auditapi

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleListGateways(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	items, err := s.ListGateways(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleListCountries(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	items, err := s.ListCountries(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleListTenantGateways(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAuditAccess(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	items, err := s.ListTenantGateways(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleListTenantCountries(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAuditAccess(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	items, err := s.ListTenantCountries(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleTenantGeoSummary(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAuditAccess(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	days := 30
	if raw := strings.TrimSpace(r.URL.Query().Get("days")); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 || parsed > 365 {
			app.ErrorJSON(w, http.StatusBadRequest, "days must be between 1 and 365")
			return
		}
		days = parsed
	}
	points, err := s.GetTenantGeoSummary(r.Context(), claims.TenantID, days)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"points": points})
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	query, err := parseAuditQuery(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.ListAuditLogs(r.Context(), claims.UserID, query)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListTenantLogs(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAuditAccess(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	query, err := parseAuditQuery(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.ListTenantAuditLogs(r.Context(), claims.TenantID, query)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListConnectionLogs(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return
	}
	connectionID := strings.TrimSpace(r.PathValue("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	allowed, err := s.canViewConnection(r.Context(), claims, connectionID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !allowed {
		app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
		return
	}

	query, err := parseAuditQuery(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if !isAuditAdmin(claims.TenantRole) {
		query.UserID = claims.UserID
	}

	result, err := s.ListConnectionAuditLogs(r.Context(), connectionID, query)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleListConnectionUsers(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if strings.TrimSpace(claims.TenantID) == "" {
		app.ErrorJSON(w, http.StatusForbidden, "Tenant context is required")
		return
	}
	if !isAuditAdmin(claims.TenantRole) {
		app.ErrorJSON(w, http.StatusForbidden, "Forbidden")
		return
	}
	connectionID := strings.TrimSpace(r.PathValue("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}
	allowed, err := s.canViewConnection(r.Context(), claims, connectionID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !allowed {
		app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
		return
	}

	items, err := s.ListConnectionUsers(r.Context(), connectionID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGetSessionRecording(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	sessionID := strings.TrimSpace(r.PathValue("sessionId"))
	if sessionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "sessionId is required")
		return
	}

	recording, err := s.GetSessionRecording(r.Context(), sessionID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	isOwner := recording.UserID == claims.UserID
	isAuditor := strings.TrimSpace(claims.TenantID) != "" && isAuditAdmin(claims.TenantRole)
	if !isOwner && !isAuditor {
		app.ErrorJSON(w, http.StatusNotFound, "Recording not found")
		return
	}

	app.WriteJSON(w, http.StatusOK, recording)
}
