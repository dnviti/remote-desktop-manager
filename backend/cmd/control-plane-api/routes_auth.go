package main

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authservice"
)

func (d *apiDependencies) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/config", d.publicConfigService.HandleAuthConfig)
	mux.HandleFunc("GET /api/auth/oauth/providers", d.oauthService.HandleProviders)
	mux.HandleFunc("POST /api/auth/oauth/exchange-code", d.oauthService.HandleExchangeCode)
	d.registerAuthRecoveryRoutes(mux)
	d.registerAuthMFARoutes(mux)
	mux.HandleFunc("POST /api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRegister(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyRegister) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleLogin(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-totp", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifyTOTP(w, r); err != nil {
			if errors.Is(err, authservice.ErrLegacyLogin) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/refresh", d.authService.HandleRefresh)
	mux.HandleFunc("POST /api/auth/logout", d.authService.HandleLogout)
	mux.HandleFunc("GET /api/auth/oauth/accounts", d.authenticator.Middleware(d.oauthService.HandleAccounts))
	mux.HandleFunc("POST /api/auth/oauth/link-code", d.authenticator.Middleware(d.oauthService.HandleGenerateLinkCode))
	mux.HandleFunc("POST /api/auth/oauth/vault-setup", d.authenticator.Middleware(d.oauthService.HandleSetupVault))
	mux.HandleFunc("DELETE /api/auth/oauth/link/{provider}", d.authenticator.Middleware(d.oauthService.HandleUnlink))
	mux.HandleFunc("POST /api/auth/switch-tenant", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.authService.HandleSwitchTenant(w, r, claims.UserID)
	})
}
