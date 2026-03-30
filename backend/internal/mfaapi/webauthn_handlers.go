package mfaapi

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
)

func (s Service) HandleWebAuthnRegistrationOptions(w http.ResponseWriter, r *http.Request, userID string) {
	result, err := s.GenerateWebAuthnRegistrationOptions(r.Context(), userID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	webauthnflow.SetChallengeCookie(w, r, webauthnflow.RegistrationChallengeCookieName, result.Challenge)
	app.WriteJSON(w, http.StatusOK, result)
}
