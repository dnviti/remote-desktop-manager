package authn

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
	"github.com/golang-jwt/jwt/v5"
)

type Claims struct {
	UserID     string `json:"userId"`
	Email      string `json:"email"`
	TenantID   string `json:"tenantId,omitempty"`
	TenantRole string `json:"tenantRole,omitempty"`
	IPUAHash   string `json:"ipUaHash,omitempty"`
	Type       string `json:"type,omitempty"`
	jwt.RegisteredClaims
}

type Authenticator struct {
	secret []byte
}

func NewAuthenticator() (*Authenticator, error) {
	secret, err := desktopbroker.LoadSecret("JWT_SECRET", "JWT_SECRET_FILE")
	if err != nil {
		return nil, err
	}
	return &Authenticator{secret: []byte(strings.TrimSpace(secret))}, nil
}

func (a *Authenticator) Middleware(next func(http.ResponseWriter, *http.Request, Claims)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, err := a.Authenticate(r)
		if err != nil {
			if err == errMissingAuthHeader {
				app.ErrorJSON(w, http.StatusUnauthorized, "Missing or invalid authorization header")
				return
			}
			app.ErrorJSON(w, http.StatusUnauthorized, "Invalid or expired token")
			return
		}
		next(w, r, claims)
	}
}

var errMissingAuthHeader = fmt.Errorf("missing auth header")

func (a *Authenticator) Authenticate(r *http.Request) (Claims, error) {
	var claims Claims

	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		return claims, errMissingAuthHeader
	}

	tokenString := strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	token, err := jwt.ParseWithClaims(tokenString, &claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 {
			return nil, fmt.Errorf("unexpected signing method %s", token.Method.Alg())
		}
		return a.secret, nil
	})
	if err != nil || !token.Valid {
		return Claims{}, fmt.Errorf("verify token: %w", err)
	}
	if claims.Type != "access" || claims.UserID == "" {
		return Claims{}, fmt.Errorf("invalid access token")
	}
	if claims.IPUAHash != "" && !bindingMatches(r, claims.IPUAHash) {
		return Claims{}, fmt.Errorf("binding mismatch")
	}

	return claims, nil
}

type contextKey string

const claimsContextKey contextKey = "authn.claims"

func WithClaims(ctx context.Context, claims Claims) context.Context {
	return context.WithValue(ctx, claimsContextKey, claims)
}

func ClaimsFromContext(ctx context.Context) (Claims, bool) {
	claims, ok := ctx.Value(claimsContextKey).(Claims)
	return claims, ok
}

func bindingMatches(r *http.Request, expected string) bool {
	userAgent := r.UserAgent()
	for _, ip := range candidateIPs(r) {
		if computeBindingHash(ip, userAgent) == expected {
			return true
		}
	}
	return false
}

func candidateIPs(r *http.Request) []string {
	seen := make(map[string]struct{})
	var candidates []string

	add := func(value string) {
		value = stripPort(strings.TrimSpace(value))
		value = stripV4Mapped(value)
		if value == "" {
			return
		}
		if _, exists := seen[value]; exists {
			return
		}
		seen[value] = struct{}{}
		candidates = append(candidates, value)
	}

	add(r.RemoteAddr)
	add(r.Header.Get("X-Real-IP"))

	for _, item := range strings.Split(r.Header.Get("X-Forwarded-For"), ",") {
		add(item)
	}

	return candidates
}

func computeBindingHash(ip, userAgent string) string {
	sum := sha256.Sum256([]byte(ip + "|" + userAgent))
	return hex.EncodeToString(sum[:])
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}

func stripV4Mapped(value string) string {
	return strings.TrimPrefix(value, "::ffff:")
}
