package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (d *apiDependencies) registerAuthMFARoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/passkey/options", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestPasskeyOptions(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/passkey/verify", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifyPasskey(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/request-email-code", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestEmailCode(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-email-code", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifyEmailCode(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/request-sms-code", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestSMSCode(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-sms", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifySMS(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/request-webauthn-options", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestWebAuthnOptions(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-webauthn", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifyWebAuthn(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/mfa-setup/init", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleMFASetupInit(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/mfa-setup/verify", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleMFASetupVerify(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
}
