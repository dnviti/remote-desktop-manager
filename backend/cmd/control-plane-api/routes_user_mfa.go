package main

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/mfaapi"
)

func (d *apiDependencies) registerUserMFARoutes(mux *http.ServeMux) {
	handleSMSManagement := func(fn func(http.ResponseWriter, *http.Request, string) error) http.HandlerFunc {
		return func(w http.ResponseWriter, r *http.Request) {
			claims, err := d.authenticator.Authenticate(r)
			if err != nil {
				app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
				return
			}
			if err := fn(w, r, claims.UserID); err != nil {
				if errors.Is(err, mfaapi.ErrLegacySMSMFAFlow) {
					d.legacyAPIProxy.ServeHTTP(w, r)
					return
				}
				app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
			}
		}
	}

	mux.HandleFunc("POST /api/user/2fa/setup", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleSetupTOTP(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/user/2fa/verify", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleVerifyTOTP(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/user/2fa/disable", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleDisableTOTP(w, r, claims.UserID)
	})
	mux.HandleFunc("GET /api/user/2fa/status", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleTOTPStatus(w, r, claims.UserID)
	})
	mux.HandleFunc("GET /api/user/2fa/sms/status", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleSMSStatus(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/user/2fa/sms/setup-phone", handleSMSManagement(d.mfaService.HandleSetupSMSPhone))
	mux.HandleFunc("POST /api/user/2fa/sms/verify-phone", handleSMSManagement(d.mfaService.HandleVerifySMSPhone))
	mux.HandleFunc("POST /api/user/2fa/sms/enable", handleSMSManagement(d.mfaService.HandleEnableSMS))
	mux.HandleFunc("POST /api/user/2fa/sms/send-disable-code", handleSMSManagement(d.mfaService.HandleSendSMSDisableCode))
	mux.HandleFunc("POST /api/user/2fa/sms/disable", handleSMSManagement(d.mfaService.HandleDisableSMS))
	mux.HandleFunc("GET /api/user/2fa/webauthn/status", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleWebAuthnStatus(w, r, claims.UserID)
	})
	mux.HandleFunc("GET /api/user/2fa/webauthn/credentials", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleWebAuthnCredentials(w, r, claims.UserID)
	})
	mux.HandleFunc("POST /api/user/2fa/webauthn/registration-options", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleWebAuthnRegistrationOptions(w, r, claims.UserID)
	})
	mux.HandleFunc("DELETE /api/user/2fa/webauthn/credentials/{id}", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleRemoveWebAuthnCredential(w, r, claims.UserID)
	})
	mux.HandleFunc("PATCH /api/user/2fa/webauthn/credentials/{id}", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.mfaService.HandleRenameWebAuthnCredential(w, r, claims.UserID)
	})
}
