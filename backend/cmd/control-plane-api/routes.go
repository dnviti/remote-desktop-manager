package main

import (
	"net/http"
)

func (d *apiDependencies) register(mux *http.ServeMux) {
	d.registerPublicRoutes(mux)
	d.registerAuthRoutes(mux)
	d.registerUserMFARoutes(mux)
	d.registerVaultAndSecretsRoutes(mux)
	d.registerUserAccountRoutes(mux)
	d.registerTenantRoutes(mux)
	d.registerResourceRoutes(mux)
	d.registerOperationsRoutes(mux)
	d.registerSessionRoutes(mux)
	d.registerInternalRoutes(mux)
}
