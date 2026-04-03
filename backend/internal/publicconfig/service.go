package publicconfig

import (
	"context"
	"fmt"
	"net/http"
	"os"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB       *pgxpool.Pool
	Features runtimefeatures.Manifest
}

type authConfigResponse struct {
	SelfSignupEnabled bool                     `json:"selfSignupEnabled"`
	Features          runtimefeatures.Manifest `json:"features"`
}

func (s Service) HandleAuthConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	selfSignupEnabled, err := s.getSelfSignupEnabled(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, authConfigResponse{
		SelfSignupEnabled: selfSignupEnabled,
		Features:          s.Features,
	})
}

func (s Service) getSelfSignupEnabled(ctx context.Context) (bool, error) {
	if os.Getenv("SELF_SIGNUP_ENABLED") != "true" {
		return false, nil
	}
	if s.DB == nil {
		return true, nil
	}

	var value string
	err := s.DB.QueryRow(ctx, `SELECT value FROM "AppConfig" WHERE key = 'selfSignupEnabled'`).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return true, nil
		}
		return false, fmt.Errorf("query self-signup flag: %w", err)
	}
	return value == "true", nil
}
