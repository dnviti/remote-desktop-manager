package authservice

import (
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

	webauthnflow.SetChallengeCookie(w, r, webauthnflow.AuthChallengeCookieName, result.Challenge)
	app.WriteJSON(w, http.StatusOK, result)
	return nil
}
