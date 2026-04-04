package queryrunner

import (
	"net/url"
	"strings"

	mysqlDriver "github.com/go-sql-driver/mysql"
)

func normalizePostgresSSLMode(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}

	switch strings.ToLower(value) {
	case "disable", "disabled", "false", "off", "none":
		return "disable"
	case "allow":
		return "allow"
	case "prefer", "preferred", "if-available", "optional":
		return "prefer"
	case "require", "required", "true", "on", "enabled", "tls", "ssl":
		return "require"
	case "verify-ca", "verifyca":
		return "verify-ca"
	case "verify-full", "verifyfull", "strict":
		return "verify-full"
	default:
		return strings.ToLower(value)
	}
}

func normalizeMySQLTLSConfig(raw string) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}

	switch strings.ToLower(value) {
	case "disable", "disabled", "false", "off", "none":
		return "false"
	case "prefer", "preferred", "if-available", "optional":
		return "preferred"
	case "require", "required", "true", "on", "enabled", "tls", "ssl":
		return "true"
	case "skip-verify", "skipverify", "insecure":
		return "skip-verify"
	default:
		if isRegisteredMySQLTLSProfile(value) {
			return value
		}
		return "preferred"
	}
}

func isRegisteredMySQLTLSProfile(name string) bool {
	if strings.TrimSpace(name) == "" {
		return false
	}
	_, err := mysqlDriver.ParseDSN("user:pass@tcp(localhost:3306)/demo?tls=" + url.QueryEscape(name))
	return err == nil
}
