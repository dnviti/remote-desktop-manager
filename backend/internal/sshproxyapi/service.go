package sshproxyapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB          *pgxpool.Pool
	JWTSecret   []byte
	Connections connections.Service
}

type tokenClaims struct {
	UserID       string `json:"userId"`
	ConnectionID string `json:"connectionId"`
	Purpose      string `json:"purpose"`
	jwt.RegisteredClaims
}

func (s Service) HandleCreateToken(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var body struct {
		ConnectionID string `json:"connectionId"`
	}
	if err := app.ReadJSON(r, &body); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(body.ConnectionID) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "connectionId is required")
		return
	}

	conn, err := s.Connections.GetConnection(r.Context(), claims.UserID, claims.TenantID, body.ConnectionID)
	if err != nil {
		app.ErrorJSON(w, http.StatusNotFound, "Connection not found or access denied")
		return
	}
	if conn.Type != "SSH" {
		app.ErrorJSON(w, http.StatusBadRequest, "SSH proxy tokens can only be issued for SSH connections")
		return
	}

	expiresIn := parsePositiveInt(getenv("SSH_PROXY_TOKEN_TTL_SECONDS", "300"), 300)
	expiresAt := time.Now().Add(time.Duration(expiresIn) * time.Second)
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, tokenClaims{
		UserID:       claims.UserID,
		ConnectionID: body.ConnectionID,
		Purpose:      "ssh-proxy",
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(expiresAt),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	})
	signed, err := token.SignedString(s.JWTSecret)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	_ = s.insertAuditLog(r.Context(), claims.UserID, "SSH_PROXY_TOKEN_ISSUED", body.ConnectionID, map[string]any{
		"expiresIn": expiresIn,
	}, requestIP(r))

	serverHost := sanitizeHost(r.Host)
	proxyPort := parsePositiveInt(getenv("SSH_PROXY_PORT", "2222"), 2222)

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"token":     signed,
		"expiresIn": expiresIn,
		"connectionInstructions": map[string]any{
			"command": fmt.Sprintf(`echo "<token>" | nc %s %d`, serverHost, proxyPort),
			"port":    proxyPort,
			"host":    serverHost,
			"note":    fmt.Sprintf("Present this token as the first line when connecting to the SSH proxy port. The token expires in %d seconds.", expiresIn),
		},
	})
}

func (s Service) HandleStatus(w http.ResponseWriter, r *http.Request, _ authn.Claims) {
	activeSessions, err := s.countActiveProxySessions(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	enabled := getenv("SSH_PROXY_ENABLED", "false") == "true"
	port := parsePositiveInt(getenv("SSH_PROXY_PORT", "2222"), 2222)
	allowedAuthMethods := parseAllowedAuthMethods(getenv("SSH_PROXY_AUTH_METHODS", "token,keyboard-interactive"))
	app.WriteJSON(w, http.StatusOK, map[string]any{
		"enabled":            enabled,
		"port":               port,
		"listening":          enabled,
		"activeSessions":     activeSessions,
		"allowedAuthMethods": allowedAuthMethods,
	})
}

func (s Service) countActiveProxySessions(ctx context.Context) (int, error) {
	if s.DB == nil {
		return 0, errors.New("database is unavailable")
	}
	var count int
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COUNT(*)
		   FROM "ActiveSession"
		  WHERE protocol = 'SSH_PROXY'::"SessionProtocol"
		    AND status <> 'CLOSED'::"SessionStatus"`,
	).Scan(&count); err != nil {
		return 0, fmt.Errorf("count active proxy sessions: %w", err)
	}
	return count, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any, ip *string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
		 VALUES ($1, $2, $3::"AuditAction", 'Connection', $4, $5::jsonb, $6)`,
		uuid.NewString(),
		userID,
		action,
		targetID,
		string(payload),
		ip,
	)
	return err
}

func parseAllowedAuthMethods(raw string) []string {
	items := strings.Split(raw, ",")
	result := make([]string, 0, len(items))
	for _, item := range items {
		item = strings.TrimSpace(item)
		if item != "" {
			result = append(result, item)
		}
	}
	return result
}

func sanitizeHost(hostport string) string {
	host := strings.TrimSpace(hostport)
	if parsedHost, _, err := net.SplitHostPort(host); err == nil {
		host = parsedHost
	}
	host = strings.Trim(host, "[]")
	if host == "" {
		return "localhost"
	}
	filtered := strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r
		case r >= 'A' && r <= 'Z':
			return r
		case r >= '0' && r <= '9':
			return r
		case r == '.' || r == '-' || r == ':':
			return r
		default:
			return -1
		}
	}, host)
	if filtered == "" {
		return "localhost"
	}
	return filtered
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			host, _, err := net.SplitHostPort(value)
			if err == nil {
				value = host
			}
			if value != "" {
				return &value
			}
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return &host
	}
	if value := strings.TrimSpace(r.RemoteAddr); value != "" {
		return &value
	}
	return nil
}

func getenv(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func parsePositiveInt(raw string, fallback int) int {
	value, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil || value <= 0 {
		return fallback
	}
	return value
}
