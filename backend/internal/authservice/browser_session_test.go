package authservice

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/redis/go-redis/v9"
)

func TestHandleActivityTouchExtendsExistingBrowserSessionWithoutRotatingCSRF(t *testing.T) {
	t.Parallel()

	svc, redisServer := newBrowserSessionTestService(t)
	ctx := context.Background()
	initialTTL := time.Minute
	state, err := json.Marshal(browserSessionState{
		UserID:    "user-1",
		ExpiresAt: time.Now().Add(initialTTL).UTC(),
	})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	if err := svc.Redis.Set(ctx, browserSessionKeyPrefix+"session-1", state, initialTTL).Err(); err != nil {
		t.Fatalf("Set() error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/auth/activity", nil)
	req.AddCookie(&http.Cookie{Name: svc.browserSessionCookieName(), Value: "session-1"})
	req.AddCookie(&http.Cookie{Name: svc.csrfCookieName(), Value: "csrf-token"})
	rec := httptest.NewRecorder()

	svc.HandleActivityTouch(rec, req, authn.Claims{UserID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleActivityTouch() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ttl := redisServer.TTL(browserSessionKeyPrefix + "session-1"); ttl < 40*time.Minute {
		t.Fatalf("session TTL = %s, want >= 40m", ttl)
	}

	cookies := rec.Result().Cookies()
	assertCookieValue(t, cookies, svc.browserSessionCookieName(), "session-1")
	assertCookieValue(t, cookies, svc.csrfCookieName(), "csrf-token")
	assertCookieAbsent(t, cookies, svc.refreshCookieName())
	assertCookieExpiryAtLeast(t, cookies, svc.browserSessionCookieName(), 40*time.Minute)
	assertCookieExpiryAtLeast(t, cookies, svc.csrfCookieName(), 40*time.Minute)
	assertBrowserSessionUser(t, svc.Redis, "session-1", "user-1")
}

func TestHandleActivityTouchCreatesBrowserSessionWhenMissing(t *testing.T) {
	t.Parallel()

	svc, redisServer := newBrowserSessionTestService(t)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/activity", nil)
	req.AddCookie(&http.Cookie{Name: svc.csrfCookieName(), Value: "csrf-token"})
	rec := httptest.NewRecorder()

	svc.HandleActivityTouch(rec, req, authn.Claims{UserID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleActivityTouch() status = %d, want %d", rec.Code, http.StatusOK)
	}

	var sessionCookie *http.Cookie
	for _, cookie := range rec.Result().Cookies() {
		if cookie.Name == svc.browserSessionCookieName() {
			sessionCookie = cookie
			break
		}
	}
	if sessionCookie == nil || sessionCookie.Value == "" {
		t.Fatal("expected browser session cookie to be set")
	}
	if ttl := redisServer.TTL(browserSessionKeyPrefix + sessionCookie.Value); ttl < 40*time.Minute {
		t.Fatalf("session TTL = %s, want >= 40m", ttl)
	}
	assertCookieValue(t, rec.Result().Cookies(), svc.csrfCookieName(), "csrf-token")
	assertBrowserSessionUser(t, svc.Redis, sessionCookie.Value, "user-1")
}

func newBrowserSessionTestService(t *testing.T) (Service, *miniredis.Miniredis) {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	return Service{
		Redis:            client,
		RefreshCookieTTL: 45 * time.Minute,
	}, server
}

func assertCookieValue(t *testing.T, cookies []*http.Cookie, name, want string) {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == name {
			if cookie.Value != want {
				t.Fatalf("cookie %s = %q, want %q", name, cookie.Value, want)
			}
			return
		}
	}
	t.Fatalf("cookie %s not set", name)
}

func assertCookieAbsent(t *testing.T, cookies []*http.Cookie, name string) {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == name {
			t.Fatalf("cookie %s unexpectedly set", name)
		}
	}
}

func assertCookieExpiryAtLeast(t *testing.T, cookies []*http.Cookie, name string, minTTL time.Duration) {
	t.Helper()
	for _, cookie := range cookies {
		if cookie.Name == name {
			if time.Until(cookie.Expires) < minTTL {
				t.Fatalf("cookie %s expiry = %s, want >= %s", name, time.Until(cookie.Expires), minTTL)
			}
			return
		}
	}
	t.Fatalf("cookie %s not set", name)
}

func assertBrowserSessionUser(t *testing.T, client *redis.Client, sessionID, wantUserID string) {
	t.Helper()
	raw, err := client.Get(context.Background(), browserSessionKeyPrefix+sessionID).Bytes()
	if err != nil {
		t.Fatalf("Get() error = %v", err)
	}
	var state browserSessionState
	if err := json.Unmarshal(raw, &state); err != nil {
		t.Fatalf("json.Unmarshal() error = %v", err)
	}
	if state.UserID != wantUserID {
		t.Fatalf("state.UserID = %q, want %q", state.UserID, wantUserID)
	}
}
