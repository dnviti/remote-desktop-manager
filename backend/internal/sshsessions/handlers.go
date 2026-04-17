package sshsessions

import (
	"errors"
	"net"
	"net/http"
	"net/url"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) error {
	var payload createRequest
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return nil
	}

	result, err := s.StartSession(r.Context(), claims, payload, requestIP(r))
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return nil
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return nil
	}

	response := createResponse{
		Transport:            "terminal-broker",
		SessionID:            result.SessionID,
		Token:                result.Token,
		ExpiresAt:            result.ExpiresAt,
		WebSocketPath:        "/ws/terminal",
		WebSocketURL:         terminalWebSocketURL(r, result.Token),
		DLPPolicy:            result.DLPPolicy,
		EnforcedSSHSettings:  result.EnforcedSSHSettings,
		SFTPSupported:        false,
		FileBrowserSupported: true,
	}
	app.WriteJSON(w, http.StatusOK, response)
	return nil
}

func terminalWebSocketURL(r *http.Request, token string) string {
	forwardedProto := firstForwardedHeader(r.Header.Get("X-Forwarded-Proto"))
	forwardedHost := firstForwardedHeader(r.Header.Get("X-Forwarded-Host"))

	host := forwardedHost
	if host == "" {
		host = strings.TrimSpace(r.Host)
	}
	if host == "" {
		host = "localhost"
	}

	scheme := "ws"
	if strings.EqualFold(forwardedProto, "https") || r.TLS != nil {
		scheme = "wss"
	}

	return scheme + "://" + host + "/ws/terminal?token=" + url.QueryEscape(token)
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		strings.TrimSpace(r.Header.Get("X-Real-IP")),
		firstForwardedHeader(r.Header.Get("X-Forwarded-For")),
		strings.TrimSpace(r.RemoteAddr),
	} {
		value = stripPort(value)
		value = strings.TrimPrefix(value, "::ffff:")
		if value != "" {
			return value
		}
	}
	return ""
}

func stripPort(value string) string {
	host, _, err := net.SplitHostPort(value)
	if err == nil {
		return host
	}
	return value
}

func firstForwardedHeader(value string) string {
	if value == "" {
		return ""
	}
	parts := strings.Split(value, ",")
	return strings.TrimSpace(parts[0])
}
