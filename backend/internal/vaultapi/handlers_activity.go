package vaultapi

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleTouch(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	unlocked, err := s.TouchVaultSession(r.Context(), claims.UserID)
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"unlocked": unlocked})
}
