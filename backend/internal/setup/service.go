package setup

import (
	"context"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authservice"
	"github.com/dnviti/arsenale/backend/internal/storage"
	"github.com/dnviti/arsenale/backend/internal/tenants"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var versionPattern = regexp.MustCompile(`^(\w+)\s+([\d]+(?:\.[\d]+)?)`)

type Service struct {
	DB            *pgxpool.Pool
	Redis         *redis.Client
	ServerKey     []byte
	VaultTTL      time.Duration
	AuthService   *authservice.Service
	TenantService *tenants.Service
}

type statusResponse struct {
	Required bool `json:"required"`
}

type dbStatusResponse struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Database  string `json:"database"`
	Connected bool   `json:"connected"`
	Version   any    `json:"version"`
}

func (s Service) HandleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	required, err := s.isSetupRequired(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, statusResponse{Required: required})
}

func (s Service) HandleDBStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		w.Header().Set("Allow", http.MethodGet)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	required, err := s.isSetupRequired(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !required {
		app.ErrorJSON(w, http.StatusForbidden, "Setup has already been completed")
		return
	}

	status, err := s.getDBStatus(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, status)
}

func (s Service) isSetupRequired(ctx context.Context) (bool, error) {
	completed, err := s.isSetupCompleted(ctx)
	if err != nil {
		return false, err
	}
	if completed {
		return false, nil
	}
	if s.DB == nil {
		return true, nil
	}

	var userExists bool
	if err := s.DB.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM "User" LIMIT 1)`).Scan(&userExists); err != nil {
		return false, fmt.Errorf("query setup user existence: %w", err)
	}
	return !userExists, nil
}

func (s Service) isSetupCompleted(ctx context.Context) (bool, error) {
	if s.DB == nil {
		return false, nil
	}

	var value string
	err := s.DB.QueryRow(ctx, `SELECT value FROM "AppConfig" WHERE key = 'setupCompleted'`).Scan(&value)
	if err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("query setup flag: %w", err)
	}
	return value == "true", nil
}

func (s Service) getDBStatus(ctx context.Context) (dbStatusResponse, error) {
	databaseURL, err := storage.DatabaseURLFromEnv()
	if err != nil {
		return dbStatusResponse{}, fmt.Errorf("resolve database url: %w", err)
	}

	status := dbStatusResponse{
		Port:    5432,
		Version: nil,
	}

	if databaseURL != "" {
		if parsed, parseErr := url.Parse(databaseURL); parseErr == nil {
			status.Host = parsed.Hostname()
			status.Database = trimLeadingSlash(parsed.Path)
			if parsed.Port() != "" {
				if port, convErr := strconv.Atoi(parsed.Port()); convErr == nil {
					status.Port = port
				}
			}
		}
	}

	if s.DB == nil {
		return status, nil
	}

	checkCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var rawVersion string
	if err := s.DB.QueryRow(checkCtx, `SELECT version()`).Scan(&rawVersion); err != nil {
		return status, nil
	}

	status.Connected = true
	status.Version = sanitizeVersion(rawVersion)
	return status, nil
}

func sanitizeVersion(raw string) any {
	match := versionPattern.FindStringSubmatch(raw)
	if len(match) == 3 {
		return fmt.Sprintf("%s %s", match[1], match[2])
	}
	if raw == "" {
		return nil
	}
	return "connected"
}

func trimLeadingSlash(value string) string {
	if value == "" {
		return value
	}
	if value[0] == '/' {
		return value[1:]
	}
	return value
}
