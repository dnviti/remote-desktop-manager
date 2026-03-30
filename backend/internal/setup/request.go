package setup

import (
	"net"
	"net/http"
	"strings"
)

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		if ip := normalizeIP(value); ip != "" {
			return ip
		}
	}
	return ""
}

func firstForwardedFor(value string) string {
	for i, ch := range value {
		if ch == ',' {
			return value[:i]
		}
	}
	return value
}

func normalizeIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		value = host
	}
	return strings.Trim(value, "[]")
}
