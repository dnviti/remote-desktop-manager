package queryrunnerapi

import (
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/queryrunner"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/jackc/pgx/v5/pgxpool"
)

func RegisterRoutes(mux *http.ServeMux, defaultPool *pgxpool.Pool) {
	mux.HandleFunc("POST /v1/connectivity:validate", func(w http.ResponseWriter, r *http.Request) {
		var req contracts.DatabaseConnectivityRequest
		if err := app.ReadJSON(r, &req); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		if err := queryrunner.ValidateConnectivity(r.Context(), defaultPool, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		app.WriteJSON(w, http.StatusOK, contracts.DatabaseConnectivityResponse{OK: true})
	})

	mux.HandleFunc("POST /v1/query-runs:execute", func(w http.ResponseWriter, r *http.Request) {
		var req contracts.QueryExecutionRequest
		if err := app.ReadJSON(r, &req); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		result, err := queryrunner.ExecuteReadOnly(r.Context(), defaultPool, req)
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

		result, err := queryrunner.ExecuteQuery(r.Context(), defaultPool, req)
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

		result, err := queryrunner.FetchSchema(r.Context(), defaultPool, req)
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

		result, err := queryrunner.ExplainQuery(r.Context(), defaultPool, req)
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

		result, err := queryrunner.IntrospectQuery(r.Context(), defaultPool, req)
		if err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		app.WriteJSON(w, http.StatusOK, result)
	})
}
