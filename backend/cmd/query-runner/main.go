package main

import (
	"context"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/internal/queryrunner"
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
			mux.HandleFunc("POST /v1/query-runs:execute", func(w http.ResponseWriter, r *http.Request) {
				var req contracts.QueryExecutionRequest
				if err := app.ReadJSON(r, &req); err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				result, err := queryrunner.ExecuteReadOnly(r.Context(), db, req)
				if err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				app.WriteJSON(w, http.StatusOK, result)
			})
			mux.HandleFunc("POST /v1/query-runs:execute-any", func(w http.ResponseWriter, r *http.Request) {
				var req contracts.QueryExecutionRequest
				if err := app.ReadJSON(r, &req); err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				result, err := queryrunner.ExecuteQuery(r.Context(), db, req)
				if err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				app.WriteJSON(w, http.StatusOK, result)
			})
			mux.HandleFunc("POST /v1/schema:fetch", func(w http.ResponseWriter, r *http.Request) {
				var req contracts.SchemaFetchRequest
				if err := app.ReadJSON(r, &req); err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				result, err := queryrunner.FetchSchema(r.Context(), db, req)
				if err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				app.WriteJSON(w, http.StatusOK, result)
			})
			mux.HandleFunc("POST /v1/query-plans:explain", func(w http.ResponseWriter, r *http.Request) {
				var req contracts.QueryPlanRequest
				if err := app.ReadJSON(r, &req); err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				result, err := queryrunner.ExplainQuery(r.Context(), db, req)
				if err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				app.WriteJSON(w, http.StatusOK, result)
			})
			mux.HandleFunc("POST /v1/introspection:run", func(w http.ResponseWriter, r *http.Request) {
				var req contracts.QueryIntrospectionRequest
				if err := app.ReadJSON(r, &req); err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				result, err := queryrunner.IntrospectQuery(r.Context(), db, req)
				if err != nil {
					app.ErrorJSON(w, http.StatusBadRequest, err.Error())
					return
				}

				app.WriteJSON(w, http.StatusOK, result)
			})
		},
	}
	if err := app.Run(ctx, service); err != nil {
		panic(err)
	}
}
