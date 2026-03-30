package main

import (
	"errors"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/vaultapi"
)

func (d *apiDependencies) registerVaultAndSecretsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/vault/unlock", d.authenticator.Middleware(d.vaultService.HandleUnlock))
	mux.HandleFunc("POST /api/vault/unlock-mfa/totp", d.authenticator.Middleware(d.vaultService.HandleUnlockWithTOTP))
	mux.HandleFunc("POST /api/vault/lock", d.authenticator.Middleware(d.vaultService.HandleLock))
	mux.HandleFunc("GET /api/vault/status", d.authenticator.Middleware(d.vaultService.HandleStatus))
	mux.HandleFunc("GET /api/vault/auto-lock", d.authenticator.Middleware(d.vaultService.HandleGetAutoLock))
	mux.HandleFunc("PUT /api/vault/auto-lock", d.authenticator.Middleware(d.vaultService.HandleSetAutoLock))
	mux.HandleFunc("POST /api/vault/reveal-password", d.authenticator.Middleware(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		if err := d.vaultService.HandleRevealPassword(w, r, claims); err != nil {
			if errors.Is(err, vaultapi.ErrLegacyRevealPasswordFlow) {
				d.legacyAPIProxy.ServeHTTP(w, r)
				return
			}
		}
	}))
	mux.HandleFunc("GET /api/vault/recovery-status", d.authenticator.Middleware(d.vaultService.HandleRecoveryStatus))
	mux.HandleFunc("POST /api/vault/recover-with-key", d.authenticator.Middleware(d.vaultService.HandleRecoverWithKey))
	mux.HandleFunc("POST /api/vault/explicit-reset", d.authenticator.Middleware(d.vaultService.HandleExplicitReset))
	mux.HandleFunc("GET /api/secrets/counts", d.authenticator.Middleware(d.secretsMetaService.HandleCounts))
	mux.HandleFunc("GET /api/secrets/tenant-vault/status", d.authenticator.Middleware(d.secretsMetaService.HandleTenantVaultStatus))
	mux.HandleFunc("POST /api/secrets/tenant-vault/init", d.authenticator.Middleware(d.tenantVaultService.HandleInit))
	mux.HandleFunc("POST /api/secrets/tenant-vault/distribute", d.authenticator.Middleware(d.tenantVaultService.HandleDistribute))
	mux.HandleFunc("POST /api/secrets/{id}/rotation/enable", d.authenticator.Middleware(d.passwordRotationService.HandleEnable))
	mux.HandleFunc("POST /api/secrets/{id}/rotation/disable", d.authenticator.Middleware(d.passwordRotationService.HandleDisable))
	mux.HandleFunc("POST /api/secrets/rotation/status", d.authenticator.Middleware(d.passwordRotationService.HandleStatus))
	mux.HandleFunc("POST /api/secrets/rotation/history", d.authenticator.Middleware(d.passwordRotationService.HandleHistory))
}
