package spiffe

import (
	"crypto/subtle"
	"crypto/x509"
	"fmt"
	"net/url"
	"strings"
)

func BuildServiceID(trustDomain, serviceName string) string {
	return fmt.Sprintf("spiffe://%s/service/%s", normalizeTrustDomain(trustDomain), url.PathEscape(strings.TrimSpace(serviceName)))
}

func ExtractID(cert *x509.Certificate) (string, error) {
	for _, uri := range cert.URIs {
		if uri != nil && strings.EqualFold(uri.Scheme, "spiffe") {
			return uri.String(), nil
		}
	}
	return "", fmt.Errorf("certificate is missing a SPIFFE URI SAN")
}

func Equal(actual, expected string) bool {
	return len(actual) == len(expected) &&
		subtle.ConstantTimeCompare([]byte(actual), []byte(expected)) == 1
}

func normalizeTrustDomain(trustDomain string) string {
	return strings.ToLower(strings.TrimSpace(trustDomain))
}
