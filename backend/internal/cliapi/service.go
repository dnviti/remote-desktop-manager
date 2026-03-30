package cliapi

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/authservice"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	deviceCodeBytes      = 32
	userCodeLength       = 8
	deviceCodeTTLSeconds = 600
	pollingInterval      = 5
	userCodeChars        = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
)

type Service struct {
	DB        *pgxpool.Pool
	Auth      *authservice.Service
	ClientURL string
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func (s Service) HandleInitiateDeviceAuth(w http.ResponseWriter, r *http.Request) {
	deviceCode, userCode, expiresAt, err := s.createDeviceAuthCode(r.Context())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{
		"device_code":               deviceCode,
		"user_code":                 userCode,
		"verification_uri":          strings.TrimRight(s.ClientURL, "/") + "/device",
		"verification_uri_complete": strings.TrimRight(s.ClientURL, "/") + "/device?code=" + userCode,
		"expires_in":                int(time.Until(expiresAt).Seconds()),
		"interval":                  pollingInterval,
	})
}

func (s Service) HandleAuthorizeDevice(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		UserCode string `json:"user_code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	if err := s.authorizeDevice(r.Context(), claims.UserID, payload.UserCode); err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, map[string]any{"message": "Device authorized successfully"})
}

func (s Service) HandlePollDeviceToken(w http.ResponseWriter, r *http.Request) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, "read request body")
		return
	}

	var payload struct {
		DeviceCode string `json:"device_code"`
	}
	if len(body) > 0 {
		if err := json.Unmarshal(body, &payload); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, "invalid JSON body")
			return
		}
	}
	if strings.TrimSpace(payload.DeviceCode) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "device_code is required")
		return
	}

	result, refreshTTL, statusCode, err := s.pollDeviceToken(r.Context(), payload.DeviceCode, requestIP(r), r.UserAgent())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	if refreshToken, ok := result["refresh_token"].(string); ok && refreshToken != "" && s.Auth != nil {
		s.Auth.ApplyRefreshCookies(w, refreshToken, refreshTTL)
	}
	app.WriteJSON(w, statusCode, result)
}

func (s Service) createDeviceAuthCode(ctx context.Context) (string, string, time.Time, error) {
	if s.DB == nil {
		return "", "", time.Time{}, errors.New("database is unavailable")
	}

	deviceCodeBytesRaw := make([]byte, deviceCodeBytes)
	if _, err := rand.Read(deviceCodeBytesRaw); err != nil {
		return "", "", time.Time{}, fmt.Errorf("generate device code: %w", err)
	}
	deviceCode := hex.EncodeToString(deviceCodeBytesRaw)
	expiresAt := time.Now().Add(deviceCodeTTLSeconds * time.Second)

	finalUserCode := generateUserCode()
	for attempt := 0; attempt < 3; attempt++ {
		_, err := s.DB.Exec(ctx, `
INSERT INTO "DeviceAuthCode" (id, "deviceCode", "userCode", "expiresAt", interval, "clientId")
VALUES ($1, $2, $3, $4, $5, 'arsenale-cli')
`, uuid.NewString(), deviceCode, finalUserCode, expiresAt, pollingInterval)
		if err == nil {
			return deviceCode, finalUserCode, expiresAt, nil
		}

		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" && attempt < 2 {
			finalUserCode = generateUserCode()
			continue
		}
		return "", "", time.Time{}, fmt.Errorf("insert device auth code: %w", err)
	}

	return "", "", time.Time{}, errors.New("device auth collision retry exhausted")
}

func (s Service) authorizeDevice(ctx context.Context, userID, userCode string) error {
	if s.DB == nil {
		return errors.New("database is unavailable")
	}

	normalized := strings.ToUpper(strings.Map(func(r rune) rune {
		switch {
		case r >= 'a' && r <= 'z':
			return r - 32
		case (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9'):
			return r
		default:
			return -1
		}
	}, userCode))

	formattedCode := strings.ToUpper(strings.TrimSpace(userCode))
	if len(normalized) == userCodeLength {
		formattedCode = normalized[:4] + "-" + normalized[4:]
	}

	var (
		id         string
		expiresAt  time.Time
		authorized bool
	)
	err := s.DB.QueryRow(ctx, `
SELECT id, "expiresAt", authorized
FROM "DeviceAuthCode"
WHERE "userCode" = $1
`, formattedCode).Scan(&id, &expiresAt, &authorized)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusNotFound, message: "Invalid device code"}
		}
		return fmt.Errorf("load device auth code: %w", err)
	}

	if expiresAt.Before(time.Now()) {
		_, _ = s.DB.Exec(ctx, `DELETE FROM "DeviceAuthCode" WHERE id = $1`, id)
		return &requestError{status: http.StatusGone, message: "Device code has expired"}
	}
	if authorized {
		return &requestError{status: http.StatusConflict, message: "Device code already authorized"}
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "DeviceAuthCode"
SET "userId" = $2, authorized = true
WHERE id = $1
`, id, userID); err != nil {
		return fmt.Errorf("authorize device auth code: %w", err)
	}

	return nil
}

func (s Service) pollDeviceToken(ctx context.Context, deviceCode, ipAddress, userAgent string) (map[string]any, time.Duration, int, error) {
	if s.DB == nil {
		return nil, 0, 0, errors.New("database is unavailable")
	}
	if s.Auth == nil {
		return nil, 0, 0, errors.New("auth service is unavailable")
	}

	var (
		id         string
		userID     *string
		authorized bool
		expiresAt  time.Time
	)
	err := s.DB.QueryRow(ctx, `
SELECT id, "userId", authorized, "expiresAt"
FROM "DeviceAuthCode"
WHERE "deviceCode" = $1
`, deviceCode).Scan(&id, &userID, &authorized, &expiresAt)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return map[string]any{"error": "invalid_grant"}, 0, http.StatusBadRequest, nil
		}
		return nil, 0, 0, fmt.Errorf("load device auth token: %w", err)
	}

	if expiresAt.Before(time.Now()) {
		_, _ = s.DB.Exec(ctx, `DELETE FROM "DeviceAuthCode" WHERE id = $1`, id)
		return map[string]any{"error": "expired_token"}, 0, http.StatusUnauthorized, nil
	}

	if !authorized || userID == nil || strings.TrimSpace(*userID) == "" {
		return map[string]any{"error": "authorization_pending"}, 0, http.StatusBadRequest, nil
	}

	payload, refreshTTL, err := s.Auth.IssueDeviceAuthTokens(ctx, *userID, ipAddress, userAgent)
	if err != nil {
		return nil, 0, 0, fmt.Errorf("issue device auth tokens: %w", err)
	}

	if _, err := s.DB.Exec(ctx, `DELETE FROM "DeviceAuthCode" WHERE id = $1`, id); err != nil {
		return nil, 0, 0, fmt.Errorf("delete device auth code: %w", err)
	}

	return payload, refreshTTL, http.StatusOK, nil
}

func generateUserCode() string {
	bytes := make([]byte, userCodeLength)
	if _, err := rand.Read(bytes); err != nil {
		panic(fmt.Errorf("generate user code: %w", err))
	}

	builder := make([]byte, userCodeLength)
	limit := byte(256 - (256 % len(userCodeChars)))
	for i := range builder {
		for {
			if bytes[i] < limit {
				builder[i] = userCodeChars[int(bytes[i])%len(userCodeChars)]
				break
			}
			if _, err := rand.Read(bytes[i : i+1]); err != nil {
				panic(fmt.Errorf("generate user code byte: %w", err))
			}
		}
	}
	return string(builder[:4]) + "-" + string(builder[4:])
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		if ip := stripIP(value); ip != "" {
			return ip
		}
	}
	return ""
}

func firstForwardedFor(value string) string {
	if idx := strings.Index(value, ","); idx >= 0 {
		return strings.TrimSpace(value[:idx])
	}
	return strings.TrimSpace(value)
}

func stripIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		value = host
	}
	return strings.TrimPrefix(value, "::ffff:")
}
