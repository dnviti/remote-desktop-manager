package main

import "net/http"

func (d *apiDependencies) registerTenantRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/tenants", d.authenticator.Middleware(d.tenantService.HandleCreate))
	mux.HandleFunc("GET /api/tenants/mine", d.authenticator.Middleware(d.tenantService.HandleGetMine))
	mux.HandleFunc("GET /api/tenants/mine/all", d.authenticator.Middleware(d.tenantService.HandleListMine))
	mux.HandleFunc("PUT /api/tenants/{id}", d.authenticator.Middleware(d.tenantService.HandleUpdate))
	mux.HandleFunc("DELETE /api/tenants/{id}", d.authenticator.Middleware(d.tenantService.HandleDelete))
	mux.HandleFunc("GET /api/tenants/{id}/ip-allowlist", d.authenticator.Middleware(d.tenantService.HandleGetIPAllowlist))
	mux.HandleFunc("PUT /api/tenants/{id}/ip-allowlist", d.authenticator.Middleware(d.tenantService.HandleUpdateIPAllowlist))
	mux.HandleFunc("GET /api/tenants/{id}/mfa-stats", d.authenticator.Middleware(d.tenantService.HandleGetMFAStats))
	mux.HandleFunc("GET /api/tenants/{id}/users", d.authenticator.Middleware(d.tenantService.HandleListUsers))
	mux.HandleFunc("POST /api/tenants/{id}/invite", d.authenticator.Middleware(d.tenantService.HandleInviteUser))
	mux.HandleFunc("POST /api/tenants/{id}/users", d.authenticator.Middleware(d.tenantService.HandleCreateUser))
	mux.HandleFunc("GET /api/tenants/{id}/users/{userId}/profile", d.authenticator.Middleware(d.tenantService.HandleGetUserProfile))
	mux.HandleFunc("PUT /api/tenants/{id}/users/{userId}", d.authenticator.Middleware(d.tenantService.HandleUpdateUserRole))
	mux.HandleFunc("DELETE /api/tenants/{id}/users/{userId}", d.authenticator.Middleware(d.tenantService.HandleRemoveUser))
	mux.HandleFunc("PATCH /api/tenants/{id}/users/{userId}/enabled", d.authenticator.Middleware(d.tenantService.HandleToggleUserEnabled))
	mux.HandleFunc("PATCH /api/tenants/{id}/users/{userId}/expiry", d.authenticator.Middleware(d.tenantService.HandleUpdateMembershipExpiry))
	mux.HandleFunc("PUT /api/tenants/{id}/users/{userId}/email", d.authenticator.Middleware(d.tenantService.HandleAdminChangeUserEmail))
	mux.HandleFunc("PUT /api/tenants/{id}/users/{userId}/password", d.authenticator.Middleware(d.tenantService.HandleAdminChangeUserPassword))
	mux.HandleFunc("GET /api/tenants/{id}/users/{userId}/permissions", d.authenticator.Middleware(d.tenantService.HandleGetUserPermissions))
	mux.HandleFunc("PUT /api/tenants/{id}/users/{userId}/permissions", d.authenticator.Middleware(d.tenantService.HandleUpdateUserPermissions))
}
