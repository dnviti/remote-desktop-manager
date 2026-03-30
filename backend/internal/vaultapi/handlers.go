package vaultapi

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleLock(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.SoftLock(r.Context(), claims.UserID, requestIP(r)); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"unlocked": false})
}

func (s Service) HandleUnlock(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload unlockPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.Unlock(r.Context(), claims.UserID, payload.Password, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleGetAutoLock(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetAutoLockPreference(r.Context(), claims.UserID, claims.TenantID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRecoveryStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetRecoveryStatus(r.Context(), claims.UserID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRecoverWithKey(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload recoverPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.RecoverWithKey(r.Context(), claims.UserID, payload.RecoveryKey, payload.Password, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleExplicitReset(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload explicitResetPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if !payload.ConfirmReset {
		app.ErrorJSON(w, http.StatusBadRequest, "confirmReset must be true")
		return
	}

	result, err := s.ExplicitReset(r.Context(), claims.UserID, payload.Password, requestIP(r))
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleSetAutoLock(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		AutoLockMinutes *int `json:"autoLockMinutes"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.SetAutoLockPreference(r.Context(), claims.UserID, claims.TenantID, payload.AutoLockMinutes)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleRevealPassword(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	var payload revealPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if payload.ConnectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return nil
	}

	result, err := s.RevealPassword(r.Context(), claims.UserID, payload.ConnectionID, payload.Password)
	if err != nil {
		if errors.Is(err, ErrLegacyRevealPasswordFlow) {
			return err
		}
		s.writeError(w, err)
		return nil
	}
	if err := s.insertConnectionAuditLog(r.Context(), claims.UserID, "PASSWORD_REVEAL", payload.ConnectionID, requestIP(r)); err != nil {
		s.writeError(w, err)
		return nil
	}
	app.WriteJSON(w, http.StatusOK, result)
	return nil
}
