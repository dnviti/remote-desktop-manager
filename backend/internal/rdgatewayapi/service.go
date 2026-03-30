package rdgatewayapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"regexp"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var hostnamePattern = regexp.MustCompile(`^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$`)

type Config struct {
	Enabled            bool   `json:"enabled"`
	ExternalHostname   string `json:"externalHostname"`
	Port               int    `json:"port"`
	IdleTimeoutSeconds int    `json:"idleTimeoutSeconds"`
}

type Status struct {
	ActiveTunnels  int `json:"activeTunnels"`
	ActiveChannels int `json:"activeChannels"`
}

type updateConfigRequest struct {
	Enabled            *bool   `json:"enabled"`
	ExternalHostname   *string `json:"externalHostname"`
	Port               *int    `json:"port"`
	IdleTimeoutSeconds *int    `json:"idleTimeoutSeconds"`
}

type Service struct {
	DB          *pgxpool.Pool
	Connections connections.Service
}

func (s Service) HandleGetConfig(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanManageRDGW(claims) {
		app.ErrorJSON(w, http.StatusForbidden, "forbidden")
		return
	}

	config, err := s.GetConfig(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, config)
}

func (s Service) HandleUpdateConfig(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanManageRDGW(claims) {
		app.ErrorJSON(w, http.StatusForbidden, "forbidden")
		return
	}

	var payload updateConfigRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	current, err := s.GetConfig(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	updated := current
	if payload.Enabled != nil {
		updated.Enabled = *payload.Enabled
	}
	if payload.ExternalHostname != nil {
		updated.ExternalHostname = strings.TrimSpace(*payload.ExternalHostname)
	}
	if payload.Port != nil {
		updated.Port = *payload.Port
	}
	if payload.IdleTimeoutSeconds != nil {
		updated.IdleTimeoutSeconds = *payload.IdleTimeoutSeconds
	}

	if updated.ExternalHostname != "" && !hostnamePattern.MatchString(updated.ExternalHostname) {
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid external hostname format")
		return
	}
	if updated.Port < 1 || updated.Port > 65535 {
		app.ErrorJSON(w, http.StatusBadRequest, "Port must be between 1 and 65535")
		return
	}
	if updated.IdleTimeoutSeconds < 0 {
		app.ErrorJSON(w, http.StatusBadRequest, "Idle timeout must be zero or greater")
		return
	}

	if err := s.UpsertConfig(r.Context(), updated); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	_ = s.insertAuditLog(r.Context(), claims.UserID, "APP_CONFIG_UPDATE", "AppConfig", "rdGatewayConfig", map[string]any{
		"previous": current,
		"updated":  updated,
	}, requestIP(r))

	app.WriteJSON(w, http.StatusOK, updated)
}

func (s Service) HandleStatus(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if !claimsCanViewRDGWStatus(claims) {
		app.ErrorJSON(w, http.StatusForbidden, "forbidden")
		return
	}

	status, err := s.GetStatus(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, status)
}

func (s Service) HandleRDPFile(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	connectionID := strings.TrimSpace(r.PathValue("connectionId"))
	if connectionID == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}

	conn, err := s.Connections.GetConnection(r.Context(), claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			app.ErrorJSON(w, http.StatusNotFound, "Connection not found")
		default:
			app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		}
		return
	}
	if !strings.EqualFold(conn.Type, "RDP") {
		app.ErrorJSON(w, http.StatusBadRequest, "RDP file generation is only available for RDP connections")
		return
	}

	config, err := s.GetConfig(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if !config.Enabled {
		app.ErrorJSON(w, http.StatusBadRequest, "RD Gateway is not enabled")
		return
	}
	if strings.TrimSpace(config.ExternalHostname) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "RD Gateway external hostname is not configured")
		return
	}

	content := generateRDPFile(rdpFileParams{
		ConnectionName:  conn.Name,
		TargetHost:      conn.Host,
		TargetPort:      conn.Port,
		GatewayHostname: config.ExternalHostname,
		GatewayPort:     config.Port,
		ScreenMode:      2,
		DesktopWidth:    1920,
		DesktopHeight:   1080,
	})

	_ = s.insertAuditLog(r.Context(), claims.UserID, "SESSION_START", "Connection", connectionID, map[string]any{
		"protocol":       "RDGW",
		"operation":      "generateRdpFile",
		"connectionName": conn.Name,
		"targetHost":     conn.Host,
		"targetPort":     conn.Port,
	}, requestIP(r))

	safeFilename := sanitizeFilename(conn.Name)
	w.Header().Set("Content-Type", "application/x-rdp")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s.rdp"`, safeFilename))
	_, _ = w.Write([]byte(content))
}

func (s Service) GetConfig(ctx context.Context) (Config, error) {
	config := defaultConfig()
	if s.DB == nil {
		return config, nil
	}

	var raw string
	err := s.DB.QueryRow(ctx, `SELECT value FROM "AppConfig" WHERE key = 'rdGatewayConfig'`).Scan(&raw)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return config, nil
		}
		return Config{}, fmt.Errorf("load rd gateway config: %w", err)
	}

	var partial Config
	if err := json.Unmarshal([]byte(raw), &partial); err != nil {
		return config, nil
	}

	if partial.ExternalHostname != "" {
		config.ExternalHostname = partial.ExternalHostname
	}
	if partial.Port != 0 {
		config.Port = partial.Port
	}
	if partial.IdleTimeoutSeconds != 0 {
		config.IdleTimeoutSeconds = partial.IdleTimeoutSeconds
	}
	config.Enabled = partial.Enabled
	return config, nil
}

func (s Service) UpsertConfig(ctx context.Context, cfg Config) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	raw, err := json.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal rd gateway config: %w", err)
	}
	_, err = s.DB.Exec(ctx, `
INSERT INTO "AppConfig" (key, value, "updatedAt")
VALUES ('rdGatewayConfig', $1, NOW())
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
`, string(raw))
	if err != nil {
		return fmt.Errorf("upsert rd gateway config: %w", err)
	}
	return nil
}

func (s Service) GetStatus(ctx context.Context, tenantID string) (Status, error) {
	if s.DB == nil {
		return Status{}, errors.New("database is unavailable")
	}

	query := `
SELECT COUNT(*)
FROM "ActiveSession" s
JOIN "Connection" c ON c.id = s."connectionId"
LEFT JOIN "Team" t ON t.id = c."teamId"
WHERE s.status <> 'CLOSED'
  AND s.protocol = 'RDP'
  AND COALESCE(s.metadata->>'transport', '') = 'rdgw'
`
	args := []any{}
	if strings.TrimSpace(tenantID) != "" {
		query += ` AND (c."teamId" IS NULL OR t."tenantId" = $1 OR EXISTS (
SELECT 1
FROM "TenantMember" tm
WHERE tm."userId" = c."userId"
  AND tm."tenantId" = $1
  AND tm."isActive" = true
))`
		args = append(args, tenantID)
	}

	var active int
	if err := s.DB.QueryRow(ctx, query, args...).Scan(&active); err != nil {
		return Status{}, fmt.Errorf("count rd gateway sessions: %w", err)
	}
	return Status{
		ActiveTunnels:  active,
		ActiveChannels: active,
	}, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetType, targetID string, details map[string]any, ip *string) error {
	if s.DB == nil || strings.TrimSpace(userID) == "" {
		return nil
	}
	var payload any
	if details != nil {
		payload = details
	}
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", $4::"AuditTargetType", $5, $6, $7)
`, uuid.NewString(), userID, action, targetType, targetID, payload, ip)
	return err
}

func claimsCanManageRDGW(claims authn.Claims) bool {
	if strings.TrimSpace(claims.TenantID) == "" {
		return false
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "ADMIN", "OWNER":
		return true
	default:
		return false
	}
}

func claimsCanViewRDGWStatus(claims authn.Claims) bool {
	if strings.TrimSpace(claims.TenantID) == "" {
		return false
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "ADMIN", "OWNER", "OPERATOR":
		return true
	default:
		return false
	}
}

func defaultConfig() Config {
	return Config{
		Enabled:            false,
		ExternalHostname:   "",
		Port:               443,
		IdleTimeoutSeconds: 3600,
	}
}

type rdpFileParams struct {
	ConnectionName  string
	TargetHost      string
	TargetPort      int
	GatewayHostname string
	GatewayPort     int
	ScreenMode      int
	DesktopWidth    int
	DesktopHeight   int
	Username        string
	Domain          string
}

func generateRDPFile(params rdpFileParams) string {
	gatewayPort := params.GatewayPort
	if gatewayPort == 0 {
		gatewayPort = 443
	}

	lines := []string{
		fmt.Sprintf("full address:s:%s:%d", params.TargetHost, params.TargetPort),
		fmt.Sprintf("server port:i:%d", params.TargetPort),
		"use redirection server name:i:1",
		fmt.Sprintf("gatewayhostname:s:%s:%d", params.GatewayHostname, gatewayPort),
		"gatewayusagemethod:i:1",
		"gatewayprofileusagemethod:i:1",
		"gatewaybrokeringtype:i:0",
		"gatewaycredentialssource:i:0",
		fmt.Sprintf("screen mode id:i:%d", defaultInt(params.ScreenMode, 2)),
		fmt.Sprintf("desktopwidth:i:%d", defaultInt(params.DesktopWidth, 1920)),
		fmt.Sprintf("desktopheight:i:%d", defaultInt(params.DesktopHeight, 1080)),
		"session bpp:i:32",
		"smart sizing:i:1",
		"dynamic resolution:i:1",
		"displayconnectionbar:i:1",
		"redirectclipboard:i:1",
		"prompt for credentials on client:i:1",
		"promptcredentialonce:i:1",
		"authentication level:i:2",
		"negotiate security layer:i:1",
		"enablecredsspsupport:i:1",
		"compression:i:1",
		"bitmapcachepersistenable:i:1",
		"autoreconnection enabled:i:1",
		"autoreconnect max retries:i:3",
	}

	if strings.TrimSpace(params.Username) != "" {
		if strings.TrimSpace(params.Domain) != "" {
			lines = append(lines, fmt.Sprintf("username:s:%s\\%s", params.Domain, params.Username))
		} else {
			lines = append(lines, fmt.Sprintf("username:s:%s", params.Username))
		}
	}

	return strings.Join(lines, "\r\n") + "\r\n"
}

func sanitizeFilename(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "connection"
	}
	var builder strings.Builder
	for _, r := range value {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.' || r == '_' || r == '-':
			builder.WriteRune(r)
		default:
			builder.WriteByte('_')
		}
	}
	sanitized := builder.String()
	if sanitized == "" {
		return "connection"
	}
	return sanitized
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			host := stripPort(value)
			if host != "" {
				return &host
			}
		}
	}
	host := stripPort(r.RemoteAddr)
	if host == "" {
		return nil
	}
	return &host
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return strings.TrimSpace(value)
}

func defaultInt(value, fallback int) int {
	if value == 0 {
		return fallback
	}
	return value
}
