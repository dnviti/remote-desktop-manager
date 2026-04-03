package authn

import (
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestAuthenticateRejectsMissingBindingClaimIssuedAfterCutoff(t *testing.T) {
	t.Parallel()

	authenticator := Authenticator{
		secret:                          []byte("test-secret"),
		tokenBinding:                    true,
		tokenBindingEnforcementCutoffAt: time.Now().Add(-15 * time.Minute),
	}

	req := newAuthenticatedRequest(t, authenticator.secret, Claims{
		UserID: "user-1",
		Email:  "user@example.com",
		Type:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-5 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}, "203.0.113.10:1234", "arsenale-test")

	if _, err := authenticator.Authenticate(req); err == nil || !strings.Contains(err.Error(), "binding missing") {
		t.Fatalf("Authenticate() error = %v, want binding missing", err)
	}
}

func TestAuthenticateAllowsMissingBindingClaimIssuedBeforeCutoff(t *testing.T) {
	t.Parallel()

	authenticator := Authenticator{
		secret:                          []byte("test-secret"),
		tokenBinding:                    true,
		tokenBindingEnforcementCutoffAt: time.Now().Add(-15 * time.Minute),
	}

	req := newAuthenticatedRequest(t, authenticator.secret, Claims{
		UserID: "user-1",
		Email:  "user@example.com",
		Type:   "access",
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-30 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(10 * time.Minute)),
		},
	}, "203.0.113.10:1234", "arsenale-test")

	claims, err := authenticator.Authenticate(req)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("claims.UserID = %q, want %q", claims.UserID, "user-1")
	}
}

func TestAuthenticateAcceptsMatchingBindingClaim(t *testing.T) {
	t.Parallel()

	authenticator := Authenticator{
		secret:                          []byte("test-secret"),
		tokenBinding:                    true,
		tokenBindingEnforcementCutoffAt: time.Now().Add(-15 * time.Minute),
	}

	req := newAuthenticatedRequest(t, authenticator.secret, Claims{
		UserID:   "user-1",
		Email:    "user@example.com",
		Type:     "access",
		IPUAHash: computeBindingHash("203.0.113.10", "arsenale-test"),
		RegisteredClaims: jwt.RegisteredClaims{
			IssuedAt:  jwt.NewNumericDate(time.Now().Add(-5 * time.Minute)),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(5 * time.Minute)),
		},
	}, "203.0.113.10:1234", "arsenale-test")

	claims, err := authenticator.Authenticate(req)
	if err != nil {
		t.Fatalf("Authenticate() error = %v", err)
	}
	if claims.UserID != "user-1" {
		t.Fatalf("claims.UserID = %q, want %q", claims.UserID, "user-1")
	}
}

func TestResolveTokenBindingEnforcementCutoffDefaultsToNow(t *testing.T) {
	t.Parallel()

	now := time.Unix(1_700_000_000, 0).UTC()
	cutoff, err := resolveTokenBindingEnforcementCutoff(now, "")
	if err != nil {
		t.Fatalf("resolveTokenBindingEnforcementCutoff() error = %v", err)
	}
	if !cutoff.Equal(now) {
		t.Fatalf("cutoff = %v, want %v", cutoff, now)
	}
}

func TestResolveTokenBindingEnforcementCutoffParsesUnixSeconds(t *testing.T) {
	t.Parallel()

	cutoff, err := resolveTokenBindingEnforcementCutoff(time.Unix(0, 0), "1700000000")
	if err != nil {
		t.Fatalf("resolveTokenBindingEnforcementCutoff() error = %v", err)
	}

	want := time.Unix(1_700_000_000, 0).UTC()
	if !cutoff.Equal(want) {
		t.Fatalf("cutoff = %v, want %v", cutoff, want)
	}
}

func TestResolveTokenBindingEnforcementCutoffParsesRFC3339(t *testing.T) {
	t.Parallel()

	cutoff, err := resolveTokenBindingEnforcementCutoff(time.Unix(0, 0), "2026-04-03T21:30:00Z")
	if err != nil {
		t.Fatalf("resolveTokenBindingEnforcementCutoff() error = %v", err)
	}

	want := time.Date(2026, 4, 3, 21, 30, 0, 0, time.UTC)
	if !cutoff.Equal(want) {
		t.Fatalf("cutoff = %v, want %v", cutoff, want)
	}
}

func TestResolveTokenBindingEnforcementCutoffRejectsInvalidValue(t *testing.T) {
	t.Parallel()

	if _, err := resolveTokenBindingEnforcementCutoff(time.Unix(0, 0), "not-a-timestamp"); err == nil {
		t.Fatal("resolveTokenBindingEnforcementCutoff() error = nil, want parse error")
	}
}

func TestNewAuthenticatorUsesConfiguredBindingCutoff(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret")
	t.Setenv("TOKEN_BINDING_ENFORCEMENT_TIMESTAMP", "1700000000")
	_ = os.Unsetenv("JWT_SECRET_FILE")

	authenticator, err := NewAuthenticator()
	if err != nil {
		t.Fatalf("NewAuthenticator() error = %v", err)
	}

	want := time.Unix(1_700_000_000, 0).UTC()
	if !authenticator.tokenBindingEnforcementCutoffAt.Equal(want) {
		t.Fatalf("tokenBindingEnforcementCutoffAt = %v, want %v", authenticator.tokenBindingEnforcementCutoffAt, want)
	}
}

func newAuthenticatedRequest(t *testing.T, secret []byte, claims Claims, remoteAddr, userAgent string) *http.Request {
	t.Helper()

	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(secret)
	if err != nil {
		t.Fatalf("SignedString() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "https://example.test/api/resource", nil)
	req.RemoteAddr = remoteAddr
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Authorization", "Bearer "+token)
	return req
}
