package main

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authservice"
)

func (d *apiDependencies) registerAuthMFARoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/request-sms-code", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestSMSCode(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-sms", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifySMS(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/request-webauthn-options", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestWebAuthnOptions(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/mfa-setup/init", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleMFASetupInit(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/mfa-setup/verify", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleMFASetupVerify(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
}
