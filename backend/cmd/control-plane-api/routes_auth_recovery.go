package main

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authservice"
)

func (d *apiDependencies) registerAuthRecoveryRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/verify-email", d.authService.HandleVerifyEmail)
	mux.HandleFunc("POST /api/auth/resend-verification", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleResendVerification(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyEmailFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/forgot-password", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleForgotPassword(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyEmailFlow) || errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/reset-password/validate", d.authService.HandleValidateResetToken)
	mux.HandleFunc("POST /api/auth/reset-password/request-sms", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRequestResetSMSCode(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/reset-password/complete", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleCompletePasswordReset(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
}
