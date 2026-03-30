package tenantvaultapi

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleInit(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureTenantAdmin(claims); err != nil {
		writeError(w, err)
		return
	}
	result, err := s.InitTenantVault(r.Context(), claims.TenantID, claims.UserID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDistribute(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := ensureTenantAdmin(claims); err != nil {
		writeError(w, err)
		return
	}

	var payload distributePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	payload.TargetUserID = strings.TrimSpace(payload.TargetUserID)
	if payload.TargetUserID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "targetUserId is required")
		return
	}

	result, err := s.DistributeTenantKeyToUser(r.Context(), claims.TenantID, payload.TargetUserID, claims.UserID, requestIP(r))
	if err != nil {
		writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func ensureTenantAdmin(claims authn.Claims) error {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusBadRequest, message: "Tenant context required"}
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "OWNER", "ADMIN":
		return nil
	default:
		return &requestError{status: http.StatusForbidden, message: "Only admins and owners can manage the tenant vault"}
	}
}

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	switch {
	case errors.As(err, &reqErr):
		app.ErrorJSON(w, reqErr.status, reqErr.message)
	case errors.Is(err, pgx.ErrNoRows):
		app.ErrorJSON(w, http.StatusNotFound, "resource not found")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if host, _, err := net.SplitHostPort(value); err == nil {
			return strings.TrimPrefix(strings.TrimSpace(host), "::ffff:")
		}
		return strings.TrimPrefix(value, "::ffff:")
	}
	return ""
}

func firstForwardedFor(value string) string {
	for _, part := range strings.Split(value, ",") {
		part = strings.TrimSpace(part)
		if part != "" {
			return part
		}
	}
	return ""
}
