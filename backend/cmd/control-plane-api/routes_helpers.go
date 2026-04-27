package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (d *apiDependencies) authenticated(next func(http.ResponseWriter, *http.Request, authn.Claims)) http.HandlerFunc {
	return d.authenticator.Middleware(next)
}

func (d *apiDependencies) authenticatedError(next func(http.ResponseWriter, *http.Request, authn.Claims) error) http.HandlerFunc {
	return d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		if err := next(w, r, claims); err != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
	})
}

func (d *apiDependencies) authenticatedUserID(next func(http.ResponseWriter, *http.Request, string)) http.HandlerFunc {
	return d.authenticated(func(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
		next(w, r, claims.UserID)
	})
}
