package mfaapi

import (
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleTOTPStatus(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.GetTOTPStatus(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleSMSStatus(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.GetSMSStatus(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleWebAuthnStatus(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.GetWebAuthnStatus(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleWebAuthnCredentials(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.ListWebAuthnCredentials(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRemoveWebAuthnCredential(w http.ResponseWriter, r *http.Request, userID string) {
	if err := s.RemoveWebAuthnCredential(r.Context(), userID, r.PathValue("id"), requestIP(r)); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"removed": true})
}

func (s Service) HandleRenameWebAuthnCredential(w http.ResponseWriter, r *http.Request, userID string) {
	var payload struct {
		FriendlyName string `json:"friendlyName"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.RenameWebAuthnCredential(r.Context(), userID, r.PathValue("id"), payload.FriendlyName); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"renamed": true})
}

func (s Service) HandleSetupTOTP(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.SetupTOTP(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleVerifyTOTP(w http.ResponseWriter, r *http.Request, userID string) {
	var payload struct {
		Code string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.VerifyAndEnableTOTP(r.Context(), userID, payload.Code, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleDisableTOTP(w http.ResponseWriter, r *http.Request, userID string) {
	var payload struct {
		Code string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.DisableTOTP(r.Context(), userID, payload.Code, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		if ip := stripIP(value); ip != "" {
			return ip
		}
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

func stripIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return strings.TrimPrefix(value, "::ffff:")
}
