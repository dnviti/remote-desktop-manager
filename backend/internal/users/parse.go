package users

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/mail"
	"net/netip"
	"os"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
)

func parseDomainProfilePatch(payload map[string]json.RawMessage) (domainProfilePatch, []string, error) {
	var (
		patch  domainProfilePatch
		fields []string
	)

	for key, raw := range payload {
		switch key {
		case "domainName":
			value, err := decodeNonNullableString(raw, key)
			if err != nil {
				return domainProfilePatch{}, nil, err
			}
			if len(*value) > 100 {
				return domainProfilePatch{}, nil, fmt.Errorf("domainName must be 100 characters or fewer")
			}
			if strings.TrimSpace(*value) == "" {
				value = nil
			}
			patch.HasDomainName = true
			patch.DomainName = value
			fields = append(fields, key)
		case "domainUsername":
			value, err := decodeNonNullableString(raw, key)
			if err != nil {
				return domainProfilePatch{}, nil, err
			}
			if len(*value) > 100 {
				return domainProfilePatch{}, nil, fmt.Errorf("domainUsername must be 100 characters or fewer")
			}
			if strings.TrimSpace(*value) == "" {
				value = nil
			}
			patch.HasDomainUsername = true
			patch.DomainUsername = value
			fields = append(fields, key)
		case "domainPassword":
			value, err := decodeNullableString(raw, key)
			if err != nil {
				return domainProfilePatch{}, nil, err
			}
			if value != nil && len(*value) > 500 {
				return domainProfilePatch{}, nil, fmt.Errorf("domainPassword must be 500 characters or fewer")
			}
			patch.HasDomainPassword = true
			patch.DomainPassword = value
			fields = append(fields, key)
		default:
			return domainProfilePatch{}, nil, fmt.Errorf("json: unknown field %q", key)
		}
	}

	return patch, fields, nil
}

func parseNotificationSchedulePatch(payload map[string]json.RawMessage) (notificationSchedulePatch, error) {
	var patch notificationSchedulePatch

	for key, raw := range payload {
		switch key {
		case "dndEnabled":
			var value bool
			if err := json.Unmarshal(raw, &value); err != nil {
				return notificationSchedulePatch{}, fmt.Errorf("dndEnabled must be a boolean")
			}
			patch.HasDNDEnabled = true
			patch.DNDEnabled = &value
		case "quietHoursStart":
			value, err := decodeNullableString(raw, "quietHoursStart")
			if err != nil {
				return notificationSchedulePatch{}, err
			}
			if value != nil && !isValidHHmm(*value) {
				return notificationSchedulePatch{}, fmt.Errorf("quietHoursStart must be HH:mm format")
			}
			patch.HasQuietHoursStart = true
			patch.QuietHoursStart = value
		case "quietHoursEnd":
			value, err := decodeNullableString(raw, "quietHoursEnd")
			if err != nil {
				return notificationSchedulePatch{}, err
			}
			if value != nil && !isValidHHmm(*value) {
				return notificationSchedulePatch{}, fmt.Errorf("quietHoursEnd must be HH:mm format")
			}
			patch.HasQuietHoursEnd = true
			patch.QuietHoursEnd = value
		case "quietHoursTimezone":
			value, err := decodeNullableString(raw, "quietHoursTimezone")
			if err != nil {
				return notificationSchedulePatch{}, err
			}
			if value != nil {
				if len(*value) > 100 {
					return notificationSchedulePatch{}, fmt.Errorf("quietHoursTimezone must be 100 characters or fewer")
				}
				if _, err := time.LoadLocation(*value); err != nil {
					return notificationSchedulePatch{}, fmt.Errorf("quietHoursTimezone must be a valid IANA timezone identifier")
				}
			}
			patch.HasQuietHoursTimezone = true
			patch.QuietHoursTimezone = value
		default:
			return notificationSchedulePatch{}, fmt.Errorf("json: unknown field %q", key)
		}
	}

	return patch, nil
}

func parseIdentityPurpose(payload map[string]json.RawMessage) (string, error) {
	if len(payload) != 1 {
		for key := range payload {
			if key != "purpose" {
				return "", &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("json: unknown field %q", key)}
			}
		}
	}

	raw, ok := payload["purpose"]
	if !ok {
		return "", &requestError{status: http.StatusBadRequest, message: "purpose is required"}
	}

	var purpose string
	if err := json.Unmarshal(raw, &purpose); err != nil {
		return "", &requestError{status: http.StatusBadRequest, message: "purpose must be a string"}
	}
	switch purpose {
	case "email-change", "password-change", "admin-action":
		return purpose, nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "purpose must be one of email-change, password-change, admin-action"}
	}
}

func parsePasswordChangePayload(r *http.Request) (string, string, *string, error) {
	var payload struct {
		OldPassword    *string `json:"oldPassword"`
		NewPassword    string  `json:"newPassword"`
		VerificationID *string `json:"verificationId"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		return "", "", nil, err
	}

	oldPassword := ""
	if payload.OldPassword != nil {
		oldPassword = *payload.OldPassword
	}
	if payload.VerificationID != nil && *payload.VerificationID != "" {
		if _, err := uuid.Parse(*payload.VerificationID); err != nil {
			return "", "", nil, &requestError{status: http.StatusBadRequest, message: "verificationId must be a valid UUID"}
		}
	}
	return oldPassword, payload.NewPassword, payload.VerificationID, nil
}

func validatePassword(password string) error {
	switch {
	case len(password) < 10:
		return &requestError{status: http.StatusBadRequest, message: "Password must be at least 10 characters"}
	case !strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain a lowercase letter"}
	case !strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain an uppercase letter"}
	case !strings.ContainsAny(password, "0123456789"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain a digit"}
	default:
		return nil
	}
}

func parseIdentityConfirmation(payload map[string]json.RawMessage) (verificationID, password string, shouldFallback bool, err error) {
	for key := range payload {
		switch key {
		case "verificationId", "password":
		case "code", "credential":
			shouldFallback = true
		default:
			return "", "", false, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("json: unknown field %q", key)}
		}
	}

	rawID, ok := payload["verificationId"]
	if !ok {
		return "", "", false, &requestError{status: http.StatusBadRequest, message: "verificationId is required"}
	}
	if err := json.Unmarshal(rawID, &verificationID); err != nil || verificationID == "" {
		return "", "", false, &requestError{status: http.StatusBadRequest, message: "verificationId must be a UUID"}
	}
	if _, parseErr := uuid.Parse(verificationID); parseErr != nil {
		return "", "", false, &requestError{status: http.StatusBadRequest, message: "verificationId must be a UUID"}
	}

	if rawPassword, ok := payload["password"]; ok {
		if err := json.Unmarshal(rawPassword, &password); err != nil {
			return "", "", false, &requestError{status: http.StatusBadRequest, message: "password must be a string"}
		}
	}

	return verificationID, password, shouldFallback, nil
}

func parseNewEmailChangePayload(payload map[string]json.RawMessage) (string, error) {
	if len(payload) != 1 {
		for key := range payload {
			if key != "newEmail" {
				return "", &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("json: unknown field %q", key)}
			}
		}
	}

	raw, ok := payload["newEmail"]
	if !ok {
		return "", &requestError{status: http.StatusBadRequest, message: "newEmail is required"}
	}

	var newEmail string
	if err := json.Unmarshal(raw, &newEmail); err != nil {
		return "", &requestError{status: http.StatusBadRequest, message: "newEmail must be a valid email"}
	}
	newEmail = strings.TrimSpace(strings.ToLower(newEmail))
	if newEmail == "" {
		return "", &requestError{status: http.StatusBadRequest, message: "newEmail must be a valid email"}
	}
	if _, err := mail.ParseAddress(newEmail); err != nil {
		return "", &requestError{status: http.StatusBadRequest, message: "newEmail must be a valid email"}
	}

	return newEmail, nil
}

func parseEmailChangeConfirmation(payload map[string]json.RawMessage) (verificationID string, shouldFallback bool, err error) {
	for key := range payload {
		switch key {
		case "verificationId":
		case "codeOld", "codeNew":
			shouldFallback = true
		default:
			return "", false, &requestError{status: http.StatusBadRequest, message: fmt.Sprintf("json: unknown field %q", key)}
		}
	}
	rawID, ok := payload["verificationId"]
	if !ok {
		return "", false, &requestError{status: http.StatusBadRequest, message: "verificationId is required"}
	}
	if err := json.Unmarshal(rawID, &verificationID); err != nil || verificationID == "" {
		return "", false, &requestError{status: http.StatusBadRequest, message: "verificationId must be a UUID"}
	}
	if _, parseErr := uuid.Parse(verificationID); parseErr != nil {
		return "", false, &requestError{status: http.StatusBadRequest, message: "verificationId must be a UUID"}
	}
	return verificationID, shouldFallback, nil
}

func decodeNullableString(raw json.RawMessage, field string) (*string, error) {
	if string(raw) == "null" {
		return nil, nil
	}

	var value string
	if err := json.Unmarshal(raw, &value); err != nil {
		return nil, fmt.Errorf("%s must be a string or null", field)
	}
	return &value, nil
}

func decodeNonNullableString(raw json.RawMessage, field string) (*string, error) {
	if string(raw) == "null" {
		return nil, fmt.Errorf("%s must be a string", field)
	}
	return decodeNullableString(raw, field)
}

func isValidHHmm(value string) bool {
	return hhmmPattern.MatchString(value)
}

func emailVerificationConfigured() bool {
	provider := strings.TrimSpace(strings.ToLower(os.Getenv("EMAIL_PROVIDER")))
	if provider == "" {
		provider = "smtp"
	}

	switch provider {
	case "smtp":
		return strings.TrimSpace(os.Getenv("SMTP_HOST")) != ""
	case "sendgrid":
		return loadSecretEnv("SENDGRID_API_KEY", "SENDGRID_API_KEY_FILE") != ""
	case "ses":
		return strings.TrimSpace(os.Getenv("AWS_SES_ACCESS_KEY_ID")) != "" &&
			loadSecretEnv("AWS_SES_SECRET_ACCESS_KEY", "AWS_SES_SECRET_ACCESS_KEY_FILE") != ""
	case "resend":
		return loadSecretEnv("RESEND_API_KEY", "RESEND_API_KEY_FILE") != ""
	case "mailgun":
		return loadSecretEnv("MAILGUN_API_KEY", "MAILGUN_API_KEY_FILE") != "" &&
			strings.TrimSpace(os.Getenv("MAILGUN_DOMAIN")) != ""
	default:
		return false
	}
}

func loadSecretEnv(name, fileName string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	if path := strings.TrimSpace(os.Getenv(fileName)); path != "" {
		payload, err := os.ReadFile(path)
		if err == nil {
			return strings.TrimSpace(string(payload))
		}
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
	if value == "" {
		return ""
	}
	return strings.TrimSpace(strings.Split(value, ",")[0])
}

func stripIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if addr, err := netip.ParseAddrPort(value); err == nil {
		return addr.Addr().Unmap().String()
	}
	if addr, err := netip.ParseAddr(value); err == nil {
		return addr.Unmap().String()
	}
	if strings.HasPrefix(value, "::ffff:") {
		return strings.TrimPrefix(value, "::ffff:")
	}
	return value
}
