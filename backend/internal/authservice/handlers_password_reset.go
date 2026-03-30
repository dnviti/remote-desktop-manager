package authservice

import (
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleForgotPassword(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		Email string `json:"email"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	if err := s.ForgotPassword(r.Context(), payload.Email, requestIP(r)); err != nil {
		switch {
		case errors.Is(err, ErrLegacyEmailFlow):
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

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"message": "If an account exists with this email, a password reset link has been sent.",
	})
	return nil
}

func (s Service) HandleValidateResetToken(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload struct {
		Token string `json:"token"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if len(strings.TrimSpace(payload.Token)) != 64 {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid token format")
		return
	}

	result, err := s.ValidateResetToken(r.Context(), payload.Token)
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

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRequestResetSMSCode(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		Token string `json:"token"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if len(strings.TrimSpace(payload.Token)) != 64 {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid token format")
		return nil
	}

	if err := s.RequestResetSMSCode(r.Context(), strings.TrimSpace(payload.Token)); err != nil {
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

	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "SMS code sent"})
	return nil
}

func (s Service) HandleCompletePasswordReset(w http.ResponseWriter, r *http.Request) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload struct {
		Token       string `json:"token"`
		NewPassword string `json:"newPassword"`
		SMSCode     string `json:"smsCode"`
		RecoveryKey string `json:"recoveryKey"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if len(strings.TrimSpace(payload.Token)) != 64 {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid token format")
		return nil
	}
	if strings.TrimSpace(payload.NewPassword) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "newPassword is required")
		return nil
	}

	result, err := s.CompletePasswordReset(
		r.Context(),
		strings.TrimSpace(payload.Token),
		payload.NewPassword,
		strings.TrimSpace(payload.SMSCode),
		strings.TrimSpace(payload.RecoveryKey),
		requestIP(r),
	)
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

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}
