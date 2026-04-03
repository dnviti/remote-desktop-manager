package main

import "net/http"

func (d *apiDependencies) registerLiveRoutes(mux *http.ServeMux) {
	if d.features.ZeroTrustEnabled {
		mux.HandleFunc("GET /api/gateways/stream", d.authenticator.Middleware(d.gatewayService.HandleStream))
		mux.HandleFunc("GET /api/gateways/{id}/instances/{instanceId}/logs/stream", d.authenticator.Middleware(d.gatewayService.HandleStreamInstanceLogs))
	}
	mux.HandleFunc("GET /api/notifications/stream", d.authenticator.Middleware(d.notificationService.HandleStream))
	if d.features.KeychainEnabled {
		mux.HandleFunc("GET /api/vault/status/stream", d.authenticator.Middleware(d.vaultService.HandleStatusStream))
	}
	if d.features.AnyConnectionFeature() {
		mux.HandleFunc("GET /api/sessions/active/stream", d.authenticator.Middleware(d.sessionAdminService.HandleStream))
	}
	mux.HandleFunc("GET /api/audit/stream", d.authenticator.Middleware(d.auditService.HandleStream))
	if d.features.DatabaseProxyEnabled {
		mux.HandleFunc("GET /api/db-audit/logs/stream", d.authenticator.Middleware(d.dbAuditService.HandleStreamLogs))
	}
}
