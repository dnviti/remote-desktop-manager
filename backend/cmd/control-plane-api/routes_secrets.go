package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (d *apiDependencies) registerVaultAndSecretsRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/vault/unlock", d.authenticator.Middleware(d.vaultService.HandleUnlock))
	mux.HandleFunc("POST /api/vault/unlock-mfa/totp", d.authenticator.Middleware(d.vaultService.HandleUnlockWithTOTP))
	mux.HandleFunc("POST /api/vault/unlock-mfa/webauthn-options", d.authenticator.Middleware(d.vaultService.HandleRequestWebAuthnOptions))
	mux.HandleFunc("POST /api/vault/unlock-mfa/webauthn", d.authenticator.Middleware(d.vaultService.HandleUnlockWithWebAuthn))
	mux.HandleFunc("POST /api/vault/unlock-mfa/request-sms", d.authenticator.Middleware(d.vaultService.HandleRequestSMSCode))
	mux.HandleFunc("POST /api/vault/unlock-mfa/sms", d.authenticator.Middleware(d.vaultService.HandleUnlockWithSMS))
	mux.HandleFunc("POST /api/vault/lock", d.authenticator.Middleware(d.vaultService.HandleLock))
	mux.HandleFunc("POST /api/vault/touch", d.authenticator.Middleware(d.vaultService.HandleTouch))
	mux.HandleFunc("GET /api/vault/status", d.authenticator.Middleware(d.vaultService.HandleStatus))
	mux.HandleFunc("GET /api/vault/auto-lock", d.authenticator.Middleware(d.vaultService.HandleGetAutoLock))
	mux.HandleFunc("PUT /api/vault/auto-lock", d.authenticator.Middleware(d.vaultService.HandleSetAutoLock))
	mux.HandleFunc("POST /api/vault/reveal-password", d.authenticator.Middleware(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		_ = d.vaultService.HandleRevealPassword(w, r, claims)
	}))
	mux.HandleFunc("GET /api/vault/recovery-status", d.authenticator.Middleware(d.vaultService.HandleRecoveryStatus))
	mux.HandleFunc("POST /api/vault/recover-with-key", d.authenticator.Middleware(d.vaultService.HandleRecoverWithKey))
	mux.HandleFunc("POST /api/vault/explicit-reset", d.authenticator.Middleware(d.vaultService.HandleExplicitReset))
	mux.HandleFunc("GET /api/secrets", d.authenticator.Middleware(d.secretsMetaService.HandleList))
	mux.HandleFunc("POST /api/secrets", d.authenticator.Middleware(d.secretsMetaService.HandleCreate))
	mux.HandleFunc("GET /api/secrets/counts", d.authenticator.Middleware(d.secretsMetaService.HandleCounts))
	mux.HandleFunc("GET /api/secrets/tenant-vault/status", d.authenticator.Middleware(d.secretsMetaService.HandleTenantVaultStatus))
	mux.HandleFunc("POST /api/secrets/breach-check", d.authenticator.Middleware(d.secretsMetaService.HandleCheckAllBreaches))
	mux.HandleFunc("DELETE /api/secrets/external-shares/{shareId}", d.authenticator.Middleware(d.secretsMetaService.HandleRevokeExternalShare))
	mux.HandleFunc("GET /api/secrets/{id}", d.authenticator.Middleware(d.secretsMetaService.HandleGet))
	mux.HandleFunc("PUT /api/secrets/{id}", d.authenticator.Middleware(d.secretsMetaService.HandleUpdate))
	mux.HandleFunc("DELETE /api/secrets/{id}", d.authenticator.Middleware(d.secretsMetaService.HandleDelete))
	mux.HandleFunc("POST /api/secrets/{id}/breach-check", d.authenticator.Middleware(d.secretsMetaService.HandleCheckBreach))
	mux.HandleFunc("GET /api/secrets/{id}/versions", d.authenticator.Middleware(d.secretsMetaService.HandleListVersions))
	mux.HandleFunc("GET /api/secrets/{id}/versions/{version}/data", d.authenticator.Middleware(d.secretsMetaService.HandleGetVersionData))
	mux.HandleFunc("POST /api/secrets/{id}/versions/{version}/restore", d.authenticator.Middleware(d.secretsMetaService.HandleRestoreVersion))
	mux.HandleFunc("POST /api/secrets/{id}/share", d.authenticator.Middleware(d.secretsMetaService.HandleShare))
	mux.HandleFunc("DELETE /api/secrets/{id}/share/{userId}", d.authenticator.Middleware(d.secretsMetaService.HandleUnshare))
	mux.HandleFunc("PUT /api/secrets/{id}/share/{userId}", d.authenticator.Middleware(d.secretsMetaService.HandleUpdateSharePermission))
	mux.HandleFunc("GET /api/secrets/{id}/shares", d.authenticator.Middleware(d.secretsMetaService.HandleListShares))
	mux.HandleFunc("POST /api/secrets/{id}/external-shares", d.authenticator.Middleware(d.secretsMetaService.HandleCreateExternalShare))
	mux.HandleFunc("GET /api/secrets/{id}/external-shares", d.authenticator.Middleware(d.secretsMetaService.HandleListExternalShares))
	mux.HandleFunc("POST /api/secrets/tenant-vault/init", d.authenticator.Middleware(d.tenantVaultService.HandleInit))
	mux.HandleFunc("POST /api/secrets/tenant-vault/distribute", d.authenticator.Middleware(d.tenantVaultService.HandleDistribute))
	mux.HandleFunc("POST /api/secrets/{id}/rotation/enable", d.authenticator.Middleware(d.passwordRotationService.HandleEnable))
	mux.HandleFunc("POST /api/secrets/{id}/rotation/disable", d.authenticator.Middleware(d.passwordRotationService.HandleDisable))
	mux.HandleFunc("POST /api/secrets/{id}/rotation/trigger", d.authenticator.Middleware(d.passwordRotationService.HandleTrigger))
	mux.HandleFunc("POST /api/secrets/rotation/status", d.authenticator.Middleware(d.passwordRotationService.HandleStatus))
	mux.HandleFunc("POST /api/secrets/rotation/history", d.authenticator.Middleware(d.passwordRotationService.HandleHistory))
}
