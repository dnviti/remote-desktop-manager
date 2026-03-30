package authservice

import (
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleVerifyEmail(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	token := strings.TrimSpace(r.URL.Query().Get("token"))
	redirectBase := s.clientURL() + "/login"
	if err := s.VerifyEmail(r.Context(), token); err != nil {
		if isRequestError(err) {
			var reqErr *requestError
			_ = errors.As(err, &reqErr)
			http.Redirect(w, r, redirectBase+"?verifyError="+url.QueryEscape(reqErr.message), http.StatusFound)
			return
		}
		http.Redirect(w, r, redirectBase+"?verifyError="+url.QueryEscape("Verification failed. Please try again."), http.StatusFound)
		return
	}

	http.Redirect(w, r, redirectBase+"?verified=true", http.StatusFound)
}

func (s Service) HandleResendVerification(w http.ResponseWriter, r *http.Request) error {
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

	err := s.ResendVerification(r.Context(), payload.Email)
	if err != nil {
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
		"message": "If an account exists with this email, a verification link has been sent.",
	})
	return nil
}
