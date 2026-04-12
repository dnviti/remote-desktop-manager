package modelgatewayapi

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/dbsessions"
	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	Store               *modelgateway.Store
	DB                  *pgxpool.Pool
	TenantAuth          tenantauth.Service
	DatabaseSessions    dbsessions.Service
	ServerEncryptionKey []byte
	AIState             *aiState
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func (s Service) HandleGetConfig(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.requireTenantRole(r.Context(), claims, "ADMIN"); err != nil {
		s.writeError(w, err)
		return
	}

	cfg, err := s.getConfig(r.Context(), claims.TenantID)
	if err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, cfg)
}

func (s Service) HandleUpdateConfig(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireDatabaseProxyFeature(); err != nil {
		s.writeError(w, err)
		return
	}
	if err := s.requireTenantRole(r.Context(), claims, "OWNER"); err != nil {
		s.writeError(w, err)
		return
	}

	var update configUpdate
	if err := app.ReadJSON(r, &update); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	cfg, err := s.saveConfig(r.Context(), claims.TenantID, claims.UserID, update)
	if err != nil {
		s.writeError(w, classifyConfigError(err))
		return
	}

	app.WriteJSON(w, http.StatusOK, cfg)
}

func (s Service) requireTenantRole(ctx context.Context, claims authn.Claims, minimum string) error {
	if strings.TrimSpace(claims.UserID) == "" || strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}

	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return fmt.Errorf("resolve tenant membership: %w", err)
	}
	if membership == nil {
		return &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}
	if !roleAtLeast(membership.Role, minimum) {
		return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
	return nil
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func requireDatabaseProxyFeature() error {
	if os.Getenv("FEATURE_DATABASE_PROXY_ENABLED") == "false" {
		return &requestError{status: http.StatusForbidden, message: "The Database SQL Proxy feature is currently disabled."}
	}
	return nil
}

func classifyConfigError(err error) error {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return reqErr
	}

	lowered := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lowered, "json: unknown field"),
		strings.Contains(lowered, "cannot unmarshal"),
		strings.Contains(lowered, "backend name is required"),
		strings.Contains(lowered, "requires a provider"),
		strings.Contains(lowered, "requires baseurl"),
		strings.Contains(lowered, "requires an apikey"),
		strings.Contains(lowered, "temperature must be between"),
		strings.Contains(lowered, "is duplicated"),
		strings.Contains(lowered, "is not configured"),
		strings.Contains(lowered, "unknown field"):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "unsupported provider"):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "server_encryption_key"):
		return &requestError{status: http.StatusServiceUnavailable, message: err.Error()}
	default:
		return err
	}
}

func roleAtLeast(role, minimum string) bool {
	order := map[string]int{
		"GUEST":      1,
		"AUDITOR":    2,
		"CONSULTANT": 3,
		"MEMBER":     4,
		"OPERATOR":   5,
		"ADMIN":      6,
		"OWNER":      7,
	}
	return order[strings.ToUpper(strings.TrimSpace(role))] >= order[strings.ToUpper(strings.TrimSpace(minimum))]
}
