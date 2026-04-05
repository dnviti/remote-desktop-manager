package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func (d *apiDependencies) registerUserAccountRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/user/profile", d.authenticator.Middleware(d.userService.HandleProfile))
	mux.HandleFunc("GET /api/user/permissions", d.authenticator.Middleware(d.userService.HandlePermissions))
	mux.HandleFunc("PUT /api/user/profile", d.authenticator.Middleware(d.userService.HandleUpdateProfile))
	mux.HandleFunc("PUT /api/user/password", d.authenticator.Middleware(d.userService.HandleChangePassword))
	mux.HandleFunc("POST /api/user/password-change/initiate", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.userService.HandleInitiatePasswordChange(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/user/identity/initiate", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.userService.HandleInitiateIdentity(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/user/identity/confirm", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.userService.HandleConfirmIdentity(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/user/email-change/initiate", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.userService.HandleInitiateEmailChange(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("POST /api/user/email-change/confirm", func(w http.ResponseWriter, r *http.Request) {
		claims, err := d.authenticator.Authenticate(r)
		if err != nil {
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		if err := d.userService.HandleConfirmEmailChange(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
	mux.HandleFunc("GET /api/user/search", d.authenticator.Middleware(d.userService.HandleSearch))
	mux.HandleFunc("PUT /api/user/ssh-defaults", d.authenticator.Middleware(d.userService.HandleUpdateSSHDefaults))
	mux.HandleFunc("PUT /api/user/rdp-defaults", d.authenticator.Middleware(d.userService.HandleUpdateRDPDefaults))
	mux.HandleFunc("POST /api/user/avatar", d.authenticator.Middleware(d.userService.HandleUploadAvatar))
	mux.HandleFunc("GET /api/user/domain-profile", d.authenticator.Middleware(d.userService.HandleGetDomainProfile))
	mux.HandleFunc("PUT /api/user/domain-profile", d.authenticator.Middleware(d.userService.HandleUpdateDomainProfile))
	mux.HandleFunc("DELETE /api/user/domain-profile", d.authenticator.Middleware(d.userService.HandleClearDomainProfile))
	mux.HandleFunc("GET /api/user/notification-schedule", d.authenticator.Middleware(d.userService.HandleGetNotificationSchedule))
	mux.HandleFunc("PUT /api/user/notification-schedule", d.authenticator.Middleware(d.userService.HandleUpdateNotificationSchedule))
}
