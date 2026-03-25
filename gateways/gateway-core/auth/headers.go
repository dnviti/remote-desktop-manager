package auth

import "net/http"

// BuildAuthHeaders constructs the HTTP headers required for TunnelBroker
// authentication. The token is a 256-bit hex bearer token.
func BuildAuthHeaders(token, gatewayID, version string) http.Header {
	h := http.Header{}
	h.Set("Authorization", "Bearer "+token)
	h.Set("X-Gateway-Id", gatewayID)
	h.Set("X-Agent-Version", version)
	return h
}
