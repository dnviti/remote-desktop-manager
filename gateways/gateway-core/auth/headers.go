package auth

import (
	"net/http"
	"net/url"
	"strings"
)

// BuildAuthHeaders constructs the HTTP headers required for TunnelBroker
// authentication. The token is a 256-bit hex bearer token.
func BuildAuthHeaders(token, gatewayID, version string) http.Header {
	return BuildAuthHeadersWithClientCert(token, gatewayID, version, "")
}

// BuildAuthHeadersWithClientCert constructs the HTTP headers required for
// TunnelBroker authentication and includes the URL-encoded client certificate
// header used by the broker's SPIFFE identity check.
func BuildAuthHeadersWithClientCert(token, gatewayID, version, clientCert string) http.Header {
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	h.Set("X-Gateway-Id", gatewayID)
	h.Set("X-Agent-Version", version)
	if strings.TrimSpace(clientCert) != "" {
		h.Set("X-Client-Cert", encodeURIComponent(clientCert))
	}
	return h
}

func encodeURIComponent(value string) string {
	return strings.ReplaceAll(url.QueryEscape(value), "+", "%20")
}
