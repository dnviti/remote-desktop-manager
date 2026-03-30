package adminapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"net/url"
	"os"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/storage"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB         *pgxpool.Pool
	TenantAuth tenantauth.Service
}

type requestError struct {
	status  int
	message string
}

type emailStatusResponse struct {
	Provider   string `json:"provider"`
	Configured bool   `json:"configured"`
	From       string `json:"from"`
	Host       string `json:"host,omitempty"`
	Port       int    `json:"port,omitempty"`
	Secure     bool   `json:"secure,omitempty"`
}

type appConfigResponse struct {
	SelfSignupEnabled   bool `json:"selfSignupEnabled"`
	SelfSignupEnvLocked bool `json:"selfSignupEnvLocked"`
}

type dbStatusResponse struct {
	Host      string `json:"host"`
	Port      int    `json:"port"`
	Database  string `json:"database"`
	Connected bool   `json:"connected"`
	Version   any    `json:"version"`
}

type authProviderDetail struct {
	Key          string `json:"key"`
	Label        string `json:"label"`
	Enabled      bool   `json:"enabled"`
	ProviderName string `json:"providerName,omitempty"`
}

func (e *requestError) Error() string {
	return e.message
}

func (s Service) HandleGetEmailStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, buildEmailStatus())
}

func (s Service) HandleSendTestEmail(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}

	var payload struct {
		To string `json:"to"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if _, err := mail.ParseAddress(strings.TrimSpace(payload.To)); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "invalid recipient email")
		return
	}

	status := buildEmailStatus()
	if status.Configured {
		s.writeError(w, &requestError{
			status:  http.StatusNotImplemented,
			message: "configured email providers still use the legacy API path",
		})
		return
	}

	if err := s.insertStandaloneAuditLog(r.Context(), claims.UserID, "EMAIL_TEST_SEND", map[string]any{
		"to":       strings.TrimSpace(payload.To),
		"provider": status.Provider,
	}); err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"success": true,
		"message": "Test email sent successfully",
	})
}

func (s Service) HandleGetAppConfig(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}

	selfSignupEnabled, err := s.getSelfSignupEnabled(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, appConfigResponse{
		SelfSignupEnabled:   selfSignupEnabled,
		SelfSignupEnvLocked: selfSignupEnvLocked(),
	})
}

func (s Service) HandleSetSelfSignup(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}

	var payload struct {
		Enabled bool `json:"enabled"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.setSelfSignupEnabled(r.Context(), payload.Enabled, claims.UserID); err != nil {
		s.writeError(w, err)
		return
	}

	app.WriteJSON(w, http.StatusOK, appConfigResponse{
		SelfSignupEnabled:   payload.Enabled,
		SelfSignupEnvLocked: selfSignupEnvLocked(),
	})
}

func (s Service) HandleGetAuthProviders(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, buildAuthProviderDetails())
}

func (s Service) HandleGetSystemSettingsDBStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.requireTenantAdmin(r.Context(), claims); err != nil {
		s.writeError(w, err)
		return
	}

	status, err := s.getDBStatus(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, status)
}

func (s Service) EmailTestRequiresLegacyProxy() bool {
	return buildEmailStatus().Configured
}

func (s Service) requireTenantAdmin(ctx context.Context, claims authn.Claims) error {
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
	if !roleAtLeast(membership.Role, "ADMIN") {
		return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
	return nil
}

func (s Service) getSelfSignupEnabled(ctx context.Context) (bool, error) {
	if selfSignupEnvLocked() {
		return false, nil
	}
	if s.DB == nil {
		return true, nil
	}

	var value string
	err := s.DB.QueryRow(ctx, `SELECT value FROM "AppConfig" WHERE key = 'selfSignupEnabled'`).Scan(&value)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return true, nil
		}
		return false, fmt.Errorf("query self-signup flag: %w", err)
	}
	return strings.EqualFold(strings.TrimSpace(value), "true"), nil
}

func (s Service) setSelfSignupEnabled(ctx context.Context, enabled bool, userID string) error {
	if selfSignupEnvLocked() {
		return &requestError{
			status:  http.StatusForbidden,
			message: "Self-signup is disabled at the environment level and cannot be changed via the admin panel.",
		}
	}
	if s.DB == nil {
		return errors.New("database is unavailable")
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin self-signup update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
INSERT INTO "AppConfig" (key, value, "updatedAt")
VALUES ('selfSignupEnabled', $1, NOW())
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
`, fmt.Sprintf("%t", enabled)); err != nil {
		return fmt.Errorf("upsert self-signup config: %w", err)
	}

	if err := insertAuditLog(ctx, tx, userID, "APP_CONFIG_UPDATE", map[string]any{
		"key":   "selfSignupEnabled",
		"value": enabled,
	}); err != nil {
		return fmt.Errorf("audit self-signup update: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit self-signup update: %w", err)
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

func selfSignupEnvLocked() bool {
	return os.Getenv("SELF_SIGNUP_ENABLED") != "true"
}

func buildEmailStatus() emailStatusResponse {
	provider := strings.TrimSpace(os.Getenv("EMAIL_PROVIDER"))
	if provider == "" {
		provider = "smtp"
	}

	status := emailStatusResponse{
		Provider: provider,
		From:     getenv("SMTP_FROM", "noreply@localhost"),
	}

	switch provider {
	case "smtp":
		status.Host = strings.TrimSpace(os.Getenv("SMTP_HOST"))
		status.Port = parseInt(getenv("SMTP_PORT", "587"), 587)
		status.Secure = status.Port == 465
		status.Configured = status.Host != ""
	case "sendgrid", "ses", "resend", "mailgun":
		status.Configured = true
	default:
		status.Configured = false
	}

	return status
}

func buildAuthProviderDetails() []authProviderDetail {
	return []authProviderDetail{
		{Key: "google", Label: "Google", Enabled: strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")) != ""},
		{Key: "microsoft", Label: "Microsoft", Enabled: strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_ID")) != ""},
		{Key: "github", Label: "GitHub", Enabled: strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")) != ""},
		{
			Key:          "oidc",
			Label:        "OIDC",
			Enabled:      strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")) != "",
			ProviderName: getenv("OIDC_PROVIDER_NAME", "SSO"),
		},
		{
			Key:          "saml",
			Label:        "SAML",
			Enabled:      strings.TrimSpace(os.Getenv("SAML_ENTRY_POINT")) != "",
			ProviderName: getenv("SAML_PROVIDER_NAME", "SAML SSO"),
		},
		{
			Key:          "ldap",
			Label:        "LDAP",
			Enabled:      os.Getenv("LDAP_ENABLED") == "true" && strings.TrimSpace(os.Getenv("LDAP_SERVER_URL")) != "",
			ProviderName: getenv("LDAP_PROVIDER_NAME", "LDAP"),
		},
	}
}

func (s Service) getDBStatus(ctx context.Context) (dbStatusResponse, error) {
	databaseURL, err := storage.DatabaseURLFromEnv()
	if err != nil {
		return dbStatusResponse{}, fmt.Errorf("resolve database url: %w", err)
	}

	status := dbStatusResponse{Port: 5432}
	if databaseURL != "" {
		if parsed, parseErr := url.Parse(databaseURL); parseErr == nil {
			status.Host = parsed.Hostname()
			status.Database = strings.TrimPrefix(parsed.Path, "/")
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

	var rawVersion string
	if err := s.DB.QueryRow(ctx, `SELECT version()`).Scan(&rawVersion); err != nil {
		return status, nil
	}
	status.Connected = true
	status.Version = sanitizeDBVersion(rawVersion)
	return status, nil
}

func sanitizeDBVersion(raw string) any {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil
	}
	fields := strings.Fields(trimmed)
	if len(fields) >= 2 {
		return fields[0] + " " + fields[1]
	}
	return "connected"
}

func roleAtLeast(actual, required string) bool {
	rank := map[string]int{
		"GUEST":      1,
		"AUDITOR":    2,
		"CONSULTANT": 3,
		"MEMBER":     4,
		"OPERATOR":   5,
		"ADMIN":      6,
		"OWNER":      7,
	}
	return rank[strings.ToUpper(actual)] >= rank[strings.ToUpper(required)]
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, action string, details map[string]any) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, details)
VALUES ($1, $2, $3, $4::jsonb)
`, uuid.NewString(), userID, action, payload)
	return err
}

func (s Service) insertStandaloneAuditLog(ctx context.Context, userID, action string, details map[string]any) error {
	if s.DB == nil {
		return nil
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin audit log insert: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := insertAuditLog(ctx, tx, userID, action, details); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit audit log: %w", err)
	}
	return nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}

func parseInt(value string, fallback int) int {
	var parsed int
	if _, err := fmt.Sscanf(strings.TrimSpace(value), "%d", &parsed); err != nil || parsed == 0 {
		return fallback
	}
	return parsed
}
