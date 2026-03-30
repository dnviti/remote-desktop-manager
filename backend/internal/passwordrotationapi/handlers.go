package passwordrotationapi

import (
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleEnable(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		IntervalDays *int `json:"intervalDays"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	intervalDays := 30
	if payload.IntervalDays != nil {
		intervalDays = *payload.IntervalDays
	}

	result, err := s.EnableRotation(r.Context(), claims.UserID, claims.TenantID, r.PathValue("id"), intervalDays, requestIP(r))
	if err != nil {
		if reqErr, ok := isRequestError(err); ok {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDisable(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.DisableRotation(r.Context(), claims.UserID, claims.TenantID, r.PathValue("id"), requestIP(r))
	if err != nil {
		if reqErr, ok := isRequestError(err); ok {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		SecretID string `json:"secretId"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	secretID := strings.TrimSpace(payload.SecretID)
	if secretID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "secretId is required")
		return
	}

	result, err := s.GetRotationStatus(r.Context(), claims.UserID, claims.TenantID, secretID)
	if err != nil {
		if reqErr, ok := isRequestError(err); ok {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleHistory(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		SecretID string `json:"secretId"`
		Limit    *int   `json:"limit"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	secretID := strings.TrimSpace(payload.SecretID)
	if secretID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "secretId is required")
		return
	}

	limit := 20
	if payload.Limit != nil {
		limit = *payload.Limit
	}

	result, err := s.GetRotationHistory(r.Context(), claims.UserID, claims.TenantID, secretID, limit)
	if err != nil {
		if reqErr, ok := isRequestError(err); ok {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		if ip := normalizeIP(value); ip != "" {
			return ip
		}
	}
	return ""
}

func firstForwardedFor(value string) string {
	for i, ch := range value {
		if ch == ',' {
			return value[:i]
		}
	}
	return value
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	return strings.TrimPrefix(value, "::ffff:")
}
