package authservice

import (
	"log/slog"
	"os"
	"strings"
)

const (
	emailVerifyTTL   = 24 * 60 * 60
	resendCooldownSec = 60
	passwordResetTTL  = 60 * 60
)

func (s Service) clientURL() string {
	if value := strings.TrimSpace(s.ClientURL); value != "" {
		return strings.TrimRight(value, "/")
	}
	if value := strings.TrimSpace(os.Getenv("CLIENT_URL")); value != "" {
		return strings.TrimRight(value, "/")
	}
	return "https://localhost:3000"
}

func emailFlowConfigured() bool {
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

func (s Service) logVerificationEmail(to, token string) {
	slog.Info("email verification link (dev mode)", "to", to, "verifyUrl", s.clientURL()+"/api/auth/verify-email?token="+token)
}

func (s Service) logPasswordResetEmail(to, token string) {
	slog.Info("password reset link (dev mode)", "to", to, "resetUrl", s.clientURL()+"/reset-password?token="+token)
}
