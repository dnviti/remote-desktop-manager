package vaultapi

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleUnlockWithTOTP(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload codePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	code, err := ParseTOTPCode(payload.Code)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UnlockWithTOTP(r.Context(), claims.UserID, code, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}
