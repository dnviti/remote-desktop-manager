package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

func (s Service) HandleProfile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	profile, err := s.GetProfile(r.Context(), claims.UserID)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, profile)
}

func (s Service) HandleUpdateProfile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload struct {
		Username *string `json:"username"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if payload.Username != nil {
		username := strings.TrimSpace(*payload.Username)
		if len(username) < 1 || len(username) > 50 {
			app.ErrorJSON(w, http.StatusBadRequest, "username must be between 1 and 50 characters")
			return
		}
		payload.Username = &username
	}

	result, err := s.UpdateProfile(r.Context(), claims.UserID, payload.Username, requestIP(r))
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleChangePassword(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	oldPassword, newPassword, verificationID, err := parsePasswordChangePayload(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.ChangePassword(r.Context(), claims.UserID, oldPassword, newPassword, verificationID, requestIP(r))
	if err != nil {
		var reqErr *requestError
		switch {
		case errors.As(err, &reqErr):
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleInitiatePasswordChange(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	result, err := s.InitiatePasswordChange(r.Context(), claims.UserID)
	if err != nil {
		switch {
		case errors.Is(err, ErrLegacyPasswordChangeInitiation):
			return err
		case errors.Is(err, errNoVerificationMethod):
			app.ErrorJSON(w, http.StatusBadRequest, errNoVerificationMethod.Error())
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleInitiateIdentity(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.InitiateIdentity(r.Context(), claims.UserID, payload)
	if err != nil {
		var reqErr *requestError
		switch {
		case errors.Is(err, ErrLegacyIdentityVerification):
			return err
		case errors.As(err, &reqErr):
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleConfirmIdentity(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	confirmed, err := s.ConfirmIdentity(r.Context(), claims.UserID, payload)
	if err != nil {
		var reqErr *requestError
		switch {
		case errors.Is(err, ErrLegacyIdentityVerification):
			return err
		case errors.As(err, &reqErr):
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"confirmed": confirmed})
	return nil
}

func (s Service) HandleInitiateEmailChange(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.InitiateEmailChange(r.Context(), claims.UserID, payload)
	if err != nil {
		var reqErr *requestError
		switch {
		case errors.Is(err, ErrLegacyEmailChangeFlow), errors.Is(err, ErrLegacyIdentityVerification):
			return ErrLegacyEmailChangeFlow
		case errors.As(err, &reqErr):
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleConfirmEmailChange(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return nil
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.ConfirmEmailChange(r.Context(), claims.UserID, payload, requestIP(r))
	if err != nil {
		var reqErr *requestError
		switch {
		case errors.Is(err, ErrLegacyEmailChangeFlow):
			return err
		case errors.As(err, &reqErr):
			app.ErrorJSON(w, reqErr.status, reqErr.message)
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return nil
	}

	app.WriteJSON(w, http.StatusOK, result)
	return nil
}

func (s Service) HandleUpdateSSHDefaults(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	s.handleJSONPreferenceUpdate(w, r, claims.UserID, "sshDefaults")
}

func (s Service) HandleUpdateRDPDefaults(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	s.handleJSONPreferenceUpdate(w, r, claims.UserID, "rdpDefaults")
}

func (s Service) HandleUploadAvatar(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload struct {
		AvatarData string `json:"avatarData"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateAvatar(r.Context(), claims.UserID, payload.AvatarData)
	if err != nil {
		if strings.Contains(err.Error(), "invalid image format") || strings.Contains(err.Error(), "too large") {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleSearch(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}
	if claims.TenantID == "" {
		app.ErrorJSON(w, http.StatusForbidden, "You must belong to an organization to perform this action")
		return
	}

	query := strings.TrimSpace(r.URL.Query().Get("q"))
	if len(query) < 1 || len(query) > 100 {
		app.ErrorJSON(w, http.StatusBadRequest, "q must be between 1 and 100 characters")
		return
	}

	rawScope := r.URL.Query().Get("scope")
	if rawScope == "" {
		rawScope = "team"
	}
	if rawScope != "tenant" && rawScope != "team" {
		app.ErrorJSON(w, http.StatusBadRequest, "scope must be one of tenant, team")
		return
	}

	teamID := strings.TrimSpace(r.URL.Query().Get("teamId"))
	if rawScope == "team" && teamID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "teamId is required when scope is team")
		return
	}

	effectiveScope := rawScope
	if rawScope == "tenant" {
		if _, ok := adminRoles[claims.TenantRole]; !ok {
			effectiveScope = "team"
		}
	}

	results, err := s.SearchUsers(r.Context(), claims.UserID, claims.TenantID, query, effectiveScope, teamID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, results)
}

func (s Service) HandleGetNotificationSchedule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	result, err := s.GetNotificationSchedule(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleGetDomainProfile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	result, err := s.GetDomainProfile(r.Context(), claims.UserID)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleUpdateDomainProfile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	patch, fields, err := parseDomainProfilePatch(payload)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateDomainProfile(r.Context(), claims.UserID, patch, fields, requestIP(r))
	if err != nil {
		switch {
		case errors.Is(err, errVaultLocked):
			app.ErrorJSON(w, http.StatusForbidden, errVaultLocked.Error())
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleClearDomainProfile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodDelete {
		w.Header().Set("Allow", http.MethodDelete)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	if err := s.ClearDomainProfile(r.Context(), claims.UserID, requestIP(r)); err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s Service) HandleUpdateNotificationSchedule(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload map[string]json.RawMessage
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	patch, err := parseNotificationSchedulePatch(payload)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateNotificationSchedule(r.Context(), claims.UserID, patch)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) handleJSONPreferenceUpdate(w http.ResponseWriter, r *http.Request, userID, column string) {
	if r.Method != http.MethodPut {
		w.Header().Set("Allow", http.MethodPut)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	var payload map[string]any
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.UpdateJSONPreference(r.Context(), userID, column, payload)
	if err != nil {
		switch err {
		case pgx.ErrNoRows:
			app.ErrorJSON(w, http.StatusNotFound, "User not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"id":   result.ID,
		column: result.Preference,
	})
}
