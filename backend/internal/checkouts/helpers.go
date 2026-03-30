package checkouts

import (
	"errors"
	"net"
	"net/http"
	"sort"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
)

func writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func parseIntQuery(raw string, fallback int) (int, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return fallback, nil
	}
	return strconv.Atoi(raw)
}

func normalizeOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func targetType(secretID, connectionID *string) string {
	if secretID != nil {
		return "VaultSecret"
	}
	if connectionID != nil {
		return "Connection"
	}
	return ""
}

func targetID(secretID, connectionID *string) string {
	if secretID != nil {
		return *secretID
	}
	if connectionID != nil {
		return *connectionID
	}
	return ""
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		ip := stripIP(value)
		if ip != "" {
			return ip
		}
	}
	return ""
}

func firstForwardedFor(value string) string {
	parts := strings.Split(value, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func stripIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return value
}

func newID() string {
	return uuid.NewString()
}

func isValidStatus(status string) bool {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case "PENDING", "APPROVED", "REJECTED", "EXPIRED", "CHECKED_IN":
		return true
	default:
		return false
	}
}

func uniqueStrings(values []string) []string {
	if len(values) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, ok := seen[value]; ok {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func stringPtr(value string) *string {
	return &value
}

func displayUserSummary(user userSummary) string {
	if user.Username != nil && strings.TrimSpace(*user.Username) != "" {
		return strings.TrimSpace(*user.Username)
	}
	if strings.TrimSpace(user.Email) != "" {
		return strings.TrimSpace(user.Email)
	}
	return "An administrator"
}

func checkoutTargetLabel(entry checkoutEntry) string {
	if entry.SecretName != nil && strings.TrimSpace(*entry.SecretName) != "" {
		return `secret "` + strings.TrimSpace(*entry.SecretName) + `"`
	}
	if entry.ConnectionName != nil && strings.TrimSpace(*entry.ConnectionName) != "" {
		return `connection "` + strings.TrimSpace(*entry.ConnectionName) + `"`
	}
	if entry.SecretID != nil {
		return "a secret"
	}
	if entry.ConnectionID != nil {
		return "a connection"
	}
	return "a resource"
}
