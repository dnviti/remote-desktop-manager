package main

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
)

func (d *apiDependencies) register(mux *http.ServeMux) {
	d.registerPublicRoutes(mux)
	d.registerAuthRoutes(mux)
	d.registerUserMFARoutes(mux)
	if d.features.HasFeature(runtimefeatures.FeatureKeychain) {
		d.registerVaultAndSecretsRoutes(mux)
	}
	d.registerUserAccountRoutes(mux)
	d.registerTenantRoutes(mux)
	d.registerResourceRoutes(mux)
	d.registerLiveRoutes(mux)
	d.registerOperationsRoutes(mux)
	if d.features.AnyConnectionFeature() {
		d.registerSessionRoutes(mux)
	}
	d.registerInternalRoutes(mux)
}
