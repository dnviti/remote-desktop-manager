package authservice

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
)

func (s Service) HandleRequestWebAuthnOptions(w http.ResponseWriter, r *http.Request) error {
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

	result, err := s.RequestWebAuthnOptions(r.Context(), strings.TrimSpace(payload.TempToken))
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

	webauthnflow.SetChallengeCookie(w, r, webauthnflow.AuthChallengeCookieName, result.Challenge)
	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleRequestPasskeyOptions(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	options, tempToken, err := s.RequestPasskeyOptions(r.Context())
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

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"tempToken": tempToken,
		"options":   options,
	})
	return nil
}

func (s Service) HandleVerifyWebAuthn(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken         string          `json:"tempToken"`
		Credential        json.RawMessage `json:"credential"`
		ExpectedChallenge string          `json:"expectedChallenge"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.VerifyWebAuthn(
		r.Context(),
		strings.TrimSpace(payload.TempToken),
		payload.Credential,
		strings.TrimSpace(payload.ExpectedChallenge),
		requestIP(r),
		r.UserAgent(),
	)
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

func (s Service) HandleVerifyPasskey(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		TempToken         string          `json:"tempToken"`
		Credential        json.RawMessage `json:"credential"`
		ExpectedChallenge string          `json:"expectedChallenge"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.VerifyPasskey(
		r.Context(),
		strings.TrimSpace(payload.TempToken),
		payload.Credential,
		strings.TrimSpace(payload.ExpectedChallenge),
		requestIP(r),
		r.UserAgent(),
	)
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

	if result.mfaSetupRequired {
		app.WriteJSON(w, http.StatusOK, map[string]any{
			"mfaSetupRequired": true,
			"tempToken":        result.tempToken,
		})
		return nil
	}
	if result.requiresMFA {
		app.WriteJSON(w, http.StatusOK, map[string]any{
			"requiresMFA":  true,
			"requiresTOTP": result.requiresTOTP,
			"methods":      result.methods,
			"tempToken":    result.tempToken,
		})
		return nil
	}
	if result.issued == nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, "passkey login flow did not return a result")
		return nil
	}

	csrfToken, err := s.ApplyBrowserAuthCookies(r.Context(), w, result.issued.user.ID, result.issued.refreshToken, result.issued.refreshExpires)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}
	app.WriteJSON(w, http.StatusOK, loginResult{
		AccessToken:       result.issued.accessToken,
		CSRFToken:         csrfToken,
		User:              result.issued.user,
		TenantMemberships: result.issued.tenantMemberships,
	})
	return nil
}
