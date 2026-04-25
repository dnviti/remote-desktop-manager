package authservice

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

func isRequestError(err error) bool {
	var reqErr *requestError
	return errors.As(err, &reqErr)
}

func (s Service) ApplyRefreshCookies(w http.ResponseWriter, refreshToken string, ttl time.Duration) string {
	s.setRefreshTokenCookie(w, refreshToken, ttl)
	return s.setCSRFCookie(w, ttl)
}

func (s Service) extractRefreshToken(r *http.Request) (string, error) {
	if cookie, err := r.Cookie(s.refreshCookieName()); err == nil && cookie.Value != "" {
		return cookie.Value, nil
	}

	body, err := io.ReadAll(r.Body)
	if err != nil {
		return "", fmt.Errorf("read request body: %w", err)
	}
	if len(body) == 0 {
		return "", nil
	}

	var payload struct {
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", fmt.Errorf("invalid JSON body")
	}
	return payload.RefreshToken, nil
}

func (s Service) clearAuthCookies(w http.ResponseWriter) {
	refreshCookie := &http.Cookie{
		Name:     s.refreshCookieName(),
		Value:    "",
		Path:     "/api/auth",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	}
	http.SetCookie(w, refreshCookie)

	browserSessionCookie := &http.Cookie{
		Name:     s.browserSessionCookieName(),
		Value:    "",
		Path:     "/api/auth",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: true,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	}
	http.SetCookie(w, browserSessionCookie)

	csrfCookie := &http.Cookie{
		Name:     s.csrfCookieName(),
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		Expires:  time.Unix(1, 0),
		HttpOnly: false,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	}
	http.SetCookie(w, csrfCookie)
}

func (s Service) validateCSRF(r *http.Request) error {
	headerToken := strings.TrimSpace(r.Header.Get("X-CSRF-Token"))
	cookie, err := r.Cookie(s.csrfCookieName())
	if err != nil || cookie == nil || cookie.Value == "" || headerToken == "" {
		return fmt.Errorf("CSRF token missing")
	}
	if subtle.ConstantTimeCompare([]byte(headerToken), []byte(cookie.Value)) != 1 {
		return fmt.Errorf("CSRF token mismatch")
	}
	return nil
}

func (s Service) ensureCSRFCookie(w http.ResponseWriter, r *http.Request, ttl time.Duration) string {
	if cookie, err := r.Cookie(s.csrfCookieName()); err == nil && cookie.Value != "" {
		s.setCSRFCookieValue(w, cookie.Value, ttl)
		return cookie.Value
	}
	return s.setCSRFCookie(w, ttl)
}

func (s Service) setRefreshTokenCookie(w http.ResponseWriter, refreshToken string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.refreshCookieName(),
		Value:    refreshToken,
		Path:     "/api/auth",
		MaxAge:   int(ttl.Seconds()),
		Expires:  time.Now().Add(ttl),
		HttpOnly: true,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	})
}

func (s Service) setBrowserSessionCookie(w http.ResponseWriter, sessionID string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.browserSessionCookieName(),
		Value:    sessionID,
		Path:     "/api/auth",
		MaxAge:   int(ttl.Seconds()),
		Expires:  time.Now().Add(ttl),
		HttpOnly: true,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	})
}

func (s Service) setCSRFCookieValue(w http.ResponseWriter, token string, ttl time.Duration) {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	http.SetCookie(w, &http.Cookie{
		Name:     s.csrfCookieName(),
		Value:    token,
		Path:     "/",
		MaxAge:   int(ttl.Seconds()),
		Expires:  time.Now().Add(ttl),
		HttpOnly: false,
		Secure:   s.CookieSecure,
		SameSite: s.cookieSameSite(),
	})
}

func (s Service) setCSRFCookie(w http.ResponseWriter, ttl time.Duration) string {
	if ttl <= 0 {
		ttl = 7 * 24 * time.Hour
	}
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate csrf token: %w", err))
	}
	token := hex.EncodeToString(buf)
	s.setCSRFCookieValue(w, token, ttl)
	return token
}

func (s Service) refreshCookieName() string {
	if s.RefreshCookie != "" {
		return s.RefreshCookie
	}
	return "arsenale-rt"
}

func (s Service) csrfCookieName() string {
	if s.CSRFCookie != "" {
		return s.CSRFCookie
	}
	return "arsenale-csrf"
}

func (s Service) browserSessionCookieName() string {
	if s.BrowserSession != "" {
		return s.BrowserSession
	}
	return "arsenale-session"
}

func (s Service) cookieSameSite() http.SameSite {
	if s.CookieSameSite != 0 {
		return s.CookieSameSite
	}
	return http.SameSiteStrictMode
}
