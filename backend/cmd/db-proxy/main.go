package main

import (
	"context"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/queryrunnerapi"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func main() {
	service := app.StaticService{
		Descriptor: contracts.ServiceMetadata{
			Name:         contracts.ServiceName("db-proxy"),
			Plane:        contracts.PlaneRuntime,
			Description:  "Database proxy middleware for remote query execution",
			DefaultPort:  5432,
			Public:       false,
			Stateless:    true,
			Dependencies: []string{"databases"},
		},
		Register: func(mux *http.ServeMux) {
			queryrunnerapi.RegisterRoutes(mux, nil)
		},
	}

	if err := app.Run(context.Background(), service); err != nil {
		panic(err)
	}
}
