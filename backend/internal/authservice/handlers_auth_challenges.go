package authservice

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleRequestSMSCode(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	if err := s.RequestLoginSMSCode(r.Context(), strings.TrimSpace(payload.TempToken)); err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "SMS code sent"})
	return nil
}

func (s Service) HandleRequestEmailCode(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	if err := s.RequestLoginEmailCode(r.Context(), strings.TrimSpace(payload.TempToken)); err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "Email code sent"})
	return nil
}

func (s Service) HandleVerifySMS(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
		Code      string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.VerifySMSCode(r.Context(), strings.TrimSpace(payload.TempToken), strings.TrimSpace(payload.Code), requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	csrfToken, err := s.ApplyBrowserAuthCookies(r.Context(), w, result.user.ID, result.refreshToken, result.refreshExpires)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusOK, loginResult{
		AccessToken:       result.accessToken,
		CSRFToken:         csrfToken,
		User:              result.user,
		TenantMemberships: result.tenantMemberships,
	})
	return nil
}

func (s Service) HandleVerifyEmailCode(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
		Code      string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.VerifyEmailCode(r.Context(), strings.TrimSpace(payload.TempToken), strings.TrimSpace(payload.Code), requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	csrfToken, err := s.ApplyBrowserAuthCookies(r.Context(), w, result.user.ID, result.refreshToken, result.refreshExpires)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusOK, loginResult{
		AccessToken:       result.accessToken,
		CSRFToken:         csrfToken,
		User:              result.user,
		TenantMemberships: result.tenantMemberships,
	})
	return nil
}

func (s Service) HandleMFASetupInit(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.SetupMFADuringLogin(r.Context(), strings.TrimSpace(payload.TempToken))
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleMFASetupVerify(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken string `json:"tempToken"`
		Code      string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.VerifyMFASetupDuringLogin(r.Context(), strings.TrimSpace(payload.TempToken), strings.TrimSpace(payload.Code), requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		} else {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	csrfToken, err := s.ApplyBrowserAuthCookies(r.Context(), w, result.user.ID, result.refreshToken, result.refreshExpires)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusOK, loginResult{
		AccessToken:       result.accessToken,
		CSRFToken:         csrfToken,
		User:              result.user,
		TenantMemberships: result.tenantMemberships,
	})
	return nil
}
