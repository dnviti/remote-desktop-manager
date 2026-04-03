package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (d *apiDependencies) registerAuthRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/auth/config", d.publicConfigService.HandleAuthConfig)
	if d.features.EnterpriseAuthEnabled {
		d.registerAuthSAMLRoutes(mux)
		mux.HandleFunc("GET /api/auth/oauth/providers", d.oauthService.HandleProviders)
		mux.HandleFunc("GET /api/auth/oauth/google", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateProvider(w, r, "google")
		})
		mux.HandleFunc("GET /api/auth/oauth/google/callback", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleCallback(w, r, "google")
		})
		mux.HandleFunc("GET /api/auth/oauth/microsoft", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateProvider(w, r, "microsoft")
		})
		mux.HandleFunc("GET /api/auth/oauth/microsoft/callback", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleCallback(w, r, "microsoft")
		})
		mux.HandleFunc("GET /api/auth/oauth/github", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateProvider(w, r, "github")
		})
		mux.HandleFunc("GET /api/auth/oauth/github/callback", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleCallback(w, r, "github")
		})
		mux.HandleFunc("GET /api/auth/oauth/oidc", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateProvider(w, r, "oidc")
		})
		mux.HandleFunc("GET /api/auth/oauth/oidc/callback", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleCallback(w, r, "oidc")
		})
		mux.HandleFunc("GET /api/auth/oauth/{provider}", d.oauthService.HandleInitiateProviderPathValue)
		mux.HandleFunc("POST /api/auth/oauth/exchange-code", d.oauthService.HandleExchangeCode)
	}
	d.registerAuthRecoveryRoutes(mux)
	d.registerAuthMFARoutes(mux)
	mux.HandleFunc("POST /api/auth/register", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleRegister(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/login", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleLogin(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/verify-totp", func(w http.ResponseWriter, r *http.Request) {
		if err := d.authService.HandleVerifyTOTP(w, r); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/auth/refresh", d.authService.HandleRefresh)
	mux.HandleFunc("GET /api/auth/session", d.authService.HandleSession)
	mux.HandleFunc("POST /api/auth/logout", d.authService.HandleLogout)
	if d.features.EnterpriseAuthEnabled {
		mux.HandleFunc("GET /api/auth/oauth/accounts", d.authenticator.Middleware(d.oauthService.HandleAccounts))
		mux.HandleFunc("POST /api/auth/oauth/link-code", d.authenticator.Middleware(d.oauthService.HandleGenerateLinkCode))
		mux.HandleFunc("GET /api/auth/oauth/link/google", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateLink(w, r, "google")
		})
		mux.HandleFunc("GET /api/auth/oauth/link/microsoft", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateLink(w, r, "microsoft")
		})
		mux.HandleFunc("GET /api/auth/oauth/link/github", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateLink(w, r, "github")
		})
		mux.HandleFunc("GET /api/auth/oauth/link/oidc", func(w http.ResponseWriter, r *http.Request) {
			d.oauthService.HandleInitiateLink(w, r, "oidc")
		})
		mux.HandleFunc("GET /api/auth/oauth/link/{provider}", d.oauthService.HandleInitiateLinkPathValue)
		mux.HandleFunc("POST /api/auth/oauth/vault-setup", d.authenticator.Middleware(d.oauthService.HandleSetupVault))
		mux.HandleFunc("DELETE /api/auth/oauth/link/{provider}", d.authenticator.Middleware(d.oauthService.HandleUnlink))
	}
	mux.HandleFunc("POST /api/auth/switch-tenant", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		d.authService.HandleSwitchTenant(w, r, claims.UserID)
	})
}
