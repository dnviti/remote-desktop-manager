package egresspolicy

import (
	"fmt"
	"net/netip"
	"strings"
)

func validateHostPattern(pattern string) error {
	pattern = normalizeHost(pattern)
	if pattern == "" {
		return fmt.Errorf("host is empty")
	}
	if pattern == "*" {
		return fmt.Errorf("bare wildcard is not allowed")
	}
	if strings.Contains(pattern, "*") {
		if !strings.HasPrefix(pattern, "*.") || strings.Count(pattern, "*") != 1 {
			return fmt.Errorf("only leading wildcard patterns like *.example.com are allowed")
		}
		suffix := strings.TrimPrefix(pattern, "*.")
		if suffix == "" || strings.Contains(suffix, "*") {
			return fmt.Errorf("wildcard suffix is empty")
		}
		if _, err := netip.ParseAddr(suffix); err == nil {
			return fmt.Errorf("wildcard IP patterns are not allowed")
		}
	}
	return nil
}

func validateCIDR(cidr string) error {
	prefix, err := netip.ParsePrefix(strings.TrimSpace(cidr))
	if err != nil {
		return err
	}
	if !prefix.IsValid() {
		return fmt.Errorf("invalid prefix")
	}
	return nil
}

func normalizeHost(host string) string {
	host = strings.TrimSpace(strings.ToLower(host))
	host = strings.TrimPrefix(host, "[")
	host = strings.TrimSuffix(host, "]")
	host = strings.TrimSuffix(host, ".")
	return host
}

func hostMatchesPattern(host, pattern string) bool {
	host = normalizeHost(host)
	pattern = normalizeHost(pattern)
	if strings.HasPrefix(pattern, "*.") {
		suffix := strings.TrimPrefix(pattern, "*")
		return strings.HasSuffix(host, suffix) && host != strings.TrimPrefix(suffix, ".")
	}
	return host == pattern
}
