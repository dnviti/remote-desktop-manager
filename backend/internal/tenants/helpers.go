package tenants

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func generateSlug(name string) string {
	slug := strings.ToLower(strings.TrimSpace(name))
	var builder strings.Builder
	lastDash := false
	for _, r := range slug {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
			lastDash = false
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
			lastDash = false
		case r == ' ' || r == '-':
			if builder.Len() > 0 && !lastDash {
				builder.WriteByte('-')
				lastDash = true
			}
		}
	}
	result := strings.Trim(builder.String(), "-")
	if len(result) > 50 {
		result = strings.Trim(result[:50], "-")
	}
	if result == "" {
		return "tenant"
	}
	return result
}

func (s Service) ensureUniqueSlug(ctx context.Context, baseSlug, excludeID string) (string, error) {
	slug := baseSlug
	suffix := 1
	for {
		var existingID string
		err := s.DB.QueryRow(ctx, `SELECT id FROM "Tenant" WHERE slug = $1`, slug).Scan(&existingID)
		if errors.Is(err, pgx.ErrNoRows) {
			return slug, nil
		}
		if err != nil {
			return "", fmt.Errorf("check tenant slug: %w", err)
		}
		if excludeID != "" && existingID == excludeID {
			return slug, nil
		}
		slug = fmt.Sprintf("%s-%d", baseSlug, suffix)
		suffix++
	}
}

func bytesTrimSpace(value []byte) []byte {
	return []byte(strings.TrimSpace(string(value)))
}

func parseRequiredBool(raw json.RawMessage, field string) (bool, error) {
	var value bool
	if err := json.Unmarshal(raw, &value); err != nil {
		return false, &requestError{status: 400, message: fmt.Sprintf("%s must be a boolean", field)}
	}
	return value, nil
}

func parseRequiredInt(raw json.RawMessage, minValue, maxValue int, field string) (int, error) {
	var value int
	if err := json.Unmarshal(raw, &value); err != nil {
		return 0, &requestError{status: 400, message: fmt.Sprintf("%s must be an integer", field)}
	}
	if value < minValue || value > maxValue {
		return 0, &requestError{status: 400, message: fmt.Sprintf("%s is out of range", field)}
	}
	return value, nil
}

func parseNullableInt(raw json.RawMessage, minValue, maxValue int, field string) (*int, error) {
	if string(raw) == "null" {
		return nil, nil
	}
	value, err := parseRequiredInt(raw, minValue, maxValue, field)
	if err != nil {
		return nil, err
	}
	return &value, nil
}

func normalizeTenantRole(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "OWNER", "ADMIN", "OPERATOR", "MEMBER", "CONSULTANT", "AUDITOR", "GUEST":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: 400, message: "role is invalid"}
	}
}
