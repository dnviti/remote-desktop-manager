package webauthnflow

import (
	"net/http"
	"strings"
	"time"
)

const (
	AuthChallengeCookieName         = "arsenale_webauthn_auth_challenge"
	RegistrationChallengeCookieName = "arsenale_webauthn_reg_challenge"
)

func SetChallengeCookie(w http.ResponseWriter, r *http.Request, name, challenge string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    challenge,
		Path:     "/api",
		HttpOnly: true,
		Secure:   cookieSecure(r),
		SameSite: http.SameSiteLaxMode,
		MaxAge:   ChallengeTTLSeconds,
		Expires:  time.Now().Add(ChallengeTTLSeconds * time.Second),
	})
}

func cookieSecure(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	if strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		return true
	}
	return false
}
