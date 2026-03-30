package mfaapi

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (s Service) HandleSetupSMSPhone(w http.ResponseWriter, r *http.Request, userID string) error {
	var payload phoneSetupPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if err := s.SetupPhone(r.Context(), userID, payload.PhoneNumber); err != nil {
		s.writeError(w, err)
		return err
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "Verification code sent"})
	return nil
}

func (s Service) HandleVerifySMSPhone(w http.ResponseWriter, r *http.Request, userID string) error {
	var payload codePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if err := s.VerifyPhone(r.Context(), userID, payload.Code, requestIP(r)); err != nil {
		s.writeError(w, err)
		return err
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"verified": true})
	return nil
}

func (s Service) HandleEnableSMS(w http.ResponseWriter, r *http.Request, userID string) error {
	if err := s.EnableSMS(r.Context(), userID, requestIP(r)); err != nil {
		s.writeError(w, err)
		return err
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"enabled": true})
	return nil
}

func (s Service) HandleSendSMSDisableCode(w http.ResponseWriter, r *http.Request, userID string) error {
	if err := s.SendDisableCode(r.Context(), userID); err != nil {
		s.writeError(w, err)
		return err
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "Verification code sent"})
	return nil
}

func (s Service) HandleDisableSMS(w http.ResponseWriter, r *http.Request, userID string) error {
	var payload codePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}
	if err := s.DisableSMS(r.Context(), userID, payload.Code, requestIP(r)); err != nil {
		s.writeError(w, err)
		return err
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"enabled": false})
	return nil
}
