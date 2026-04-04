package queryrunner

import "strings"

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
		return value
	}
}
