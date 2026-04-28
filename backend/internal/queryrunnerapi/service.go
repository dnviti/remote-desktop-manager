package queryrunnerapi

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/queryrunner"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/dnviti/arsenale/backend/pkg/egresspolicy"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	runtimePrincipalUserHeader      = "X-Arsenale-Principal-User"
	runtimePrincipalTeamsHeader     = "X-Arsenale-Principal-Teams"
	runtimePrincipalSignatureHeader = "X-Arsenale-Principal-Signature"
	runtimePrincipalSigningKeyEnv   = "RUNTIME_EGRESS_PRINCIPAL_SIGNING_KEY"
)

func RegisterRoutes(mux *http.ServeMux, defaultPool *pgxpool.Pool) {
	mux.HandleFunc("POST /v1/connectivity:validate", func(w http.ResponseWriter, r *http.Request) {
		var req contracts.DatabaseConnectivityRequest
		if err := app.ReadJSON(r, &req); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}

		if err := enforceRuntimeEgressPolicy(r, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

		if err := enforceRuntimeEgressPolicy(r, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

		if err := enforceRuntimeEgressPolicy(r, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

		if err := enforceRuntimeEgressPolicy(r, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

		if err := enforceRuntimeEgressPolicy(r, req.Target); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

		if err := enforceRuntimeEgressPolicy(r, req.DB); err != nil {
			app.ErrorJSON(w, http.StatusForbidden, err.Error())
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

func enforceRuntimeEgressPolicy(r *http.Request, target *contracts.DatabaseTarget) error {
	raw := strings.TrimSpace(os.Getenv("ARSENALE_EGRESS_POLICY_JSON"))
	if raw == "" {
		return nil
	}
	if target == nil {
		return fmt.Errorf("runtime egress denied: target is required")
	}
	userID, teamIDs, err := runtimePrincipalContext(r, json.RawMessage(raw))
	if err != nil {
		return err
	}
	decision := egresspolicy.AuthorizeRaw(r.Context(), json.RawMessage(raw), egresspolicy.Request{
		Protocol: egresspolicy.ProtocolDatabase,
		Host:     target.Host,
		Port:     target.Port,
		UserID:   userID,
		TeamIDs:  teamIDs,
	}, egresspolicy.DefaultOptions())
	if decision.Allowed {
		return nil
	}
	return fmt.Errorf("runtime egress denied: %s", decision.Reason)
}

func runtimePrincipalContext(r *http.Request, raw json.RawMessage) (string, []string, error) {
	if !egresspolicy.RequiresPrincipalRaw(raw) {
		return "", nil, nil
	}
	secret := strings.TrimSpace(os.Getenv(runtimePrincipalSigningKeyEnv))
	if secret == "" {
		return "", nil, fmt.Errorf("runtime egress denied: principal signing key is not configured")
	}
	userID := strings.TrimSpace(r.Header.Get(runtimePrincipalUserHeader))
	teamIDs := splitHeaderList(r.Header.Get(runtimePrincipalTeamsHeader))
	signature := strings.TrimSpace(r.Header.Get(runtimePrincipalSignatureHeader))
	if userID == "" || signature == "" {
		return "", nil, fmt.Errorf("runtime egress denied: principal context is required")
	}
	if !egresspolicy.VerifyPrincipalContextSignature(secret, userID, teamIDs, signature) {
		return "", nil, fmt.Errorf("runtime egress denied: principal context signature is invalid")
	}
	return userID, teamIDs, nil
}

func splitHeaderList(raw string) []string {
	parts := strings.Split(raw, ",")
	values := make([]string, 0, len(parts))
	for _, part := range parts {
		part = strings.TrimSpace(part)
		if part != "" {
			values = append(values, part)
		}
	}
	return values
}
