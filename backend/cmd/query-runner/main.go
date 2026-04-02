package main

import (
	"context"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/internal/queryrunnerapi"
	"github.com/dnviti/arsenale/backend/internal/storage"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func main() {
	ctx := context.Background()

	db, err := storage.OpenPostgres(ctx)
	if err != nil {
		panic(err)
	}
	if db != nil {
		defer db.Close()
	}

	service := app.StaticService{
		Descriptor: catalog.MustService(contracts.ServiceQueryRunner),
		Register: func(mux *http.ServeMux) {
			queryrunnerapi.RegisterRoutes(mux, db)
		},
	}
	if err := app.Run(ctx, service); err != nil {
		panic(err)
	}
}
