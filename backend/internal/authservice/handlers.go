package authservice

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleLogout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	refreshToken, err := s.extractRefreshToken(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	userID, err := s.Logout(r.Context(), refreshToken, requestIP(r))
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	s.clearAuthCookies(w)
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"userId":  userID,
	})
}

func (s Service) HandleSwitchTenant(w http.ResponseWriter, r *http.Request, userID string) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload struct {
		TenantID string `json:"tenantId"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.SwitchTenant(r.Context(), userID, strings.TrimSpace(payload.TenantID), requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	s.setRefreshTokenCookie(w, result.refreshToken, result.refreshExpires)
	csrfToken := s.setCSRFCookie(w, result.refreshExpires)
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken": result.accessToken,
		"csrfToken":   csrfToken,
		"user":        result.user,
	})
}

func (s Service) HandleRefresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "read request body")
		return
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	var payload struct {
		RefreshToken string `json:"refreshToken"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}

	extensionContext := !hasCookies(r) && payload.RefreshToken != "" && strings.HasPrefix(r.Header.Get("Authorization"), "Bearer ")
	if !extensionContext {
		if err := s.validateCSRF(r); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
			return
		}
	}

	refreshToken := payload.RefreshToken
	if cookie, err := r.Cookie(s.refreshCookieName()); err == nil && cookie.Value != "" {
		refreshToken = cookie.Value
	}
	if refreshToken == "" {
		app.ErrorJSON(w, http.StatusUnauthorized, "Missing refresh token")
		return
	}

	result, err := s.Refresh(r.Context(), refreshToken, requestIP(r), r.UserAgent())
	if err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			if reqErr.status == http.StatusUnauthorized {
				s.clearAuthCookies(w)
			}
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	if extensionContext {
		app.WriteJSON(w, http.StatusOK, map[string]any{
			"accessToken":  result.accessToken,
			"refreshToken": result.refreshToken,
			"user":         result.user,
		})
		return
	}

	s.setRefreshTokenCookie(w, result.refreshToken, result.refreshExpires)
	csrfToken := s.setCSRFCookie(w, result.refreshExpires)
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"accessToken": result.accessToken,
		"csrfToken":   csrfToken,
		"user":        result.user,
	})
}

func (s Service) HandleLogin(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "read request body")
		return nil
	}
	r.Body = io.NopCloser(bytes.NewReader(body))

	var payload struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.Login(r.Context(), strings.TrimSpace(strings.ToLower(payload.Email)), payload.Password, requestIP(r), r.UserAgent())
	if err != nil {
		switch {
		case errors.Is(err, ErrLegacyLogin):
			return err
		case isRequestError(err):
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		default:
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
		app.ErrorJSON(w, http.StatusServiceUnavailable, "login flow did not return a result")
		return nil
	}

	s.setRefreshTokenCookie(w, result.issued.refreshToken, result.issued.refreshExpires)
	csrfToken := s.setCSRFCookie(w, result.issued.refreshExpires)

	app.WriteJSON(w, http.StatusOK, loginResult{
		AccessToken:       result.issued.accessToken,
		CSRFToken:         csrfToken,
		User:              result.issued.user,
		TenantMemberships: result.issued.tenantMemberships,
	})
	return nil
}
