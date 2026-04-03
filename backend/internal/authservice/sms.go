package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/smsdelivery"
	"github.com/jackc/pgx/v5"
)

const smsOTPTTL = 5 * time.Minute

func (s Service) RequestLoginSMSCode(ctx context.Context, tempToken string) error {
	userID, purpose, err := s.parseMFATempToken(tempToken)
	if err != nil {
		return err
	}
	if purpose != "mfa-verify" {
		return &requestError{status: 401, message: "Invalid token purpose"}
	}

	user, err := s.loadSMSMFAUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.SMSMFAEnabled || strings.TrimSpace(user.PhoneNumber) == "" {
		return &requestError{status: 400, message: "SMS MFA is not available"}
	}

	return s.sendOTPToPhone(ctx, user.ID, user.PhoneNumber)
}

func (s Service) VerifySMSCode(ctx context.Context, tempToken, code, ipAddress, userAgent string) (issuedLogin, error) {
	userID, purpose, err := s.parseMFATempToken(tempToken)
	if err != nil {
		return issuedLogin{}, err
	}
	if purpose != "mfa-verify" {
		return issuedLogin{}, &requestError{status: 401, message: "Invalid token purpose"}
	}
	if err := s.enforceLoginMFARateLimit(ctx, userID, ipAddress); err != nil {
		return issuedLogin{}, err
	}
	if err := validateTOTPCode(code); err != nil {
		return issuedLogin{}, &requestError{status: 400, message: "Invalid code format"}
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return issuedLogin{}, &requestError{status: 401, message: "SMS MFA verification failed"}
		}
		return issuedLogin{}, err
	}
	if !user.SMSMFAEnabled {
		return issuedLogin{}, &requestError{status: 401, message: "SMS MFA verification failed"}
	}

	valid, err := s.verifyOTP(ctx, user.ID, code)
	if err != nil {
		return issuedLogin{}, err
	}
	if !valid {
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired SMS code"}
	}

	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return issuedLogin{}, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, err
	}
	_ = s.insertStandaloneAuditLogWithFlags(ctx, &user.ID, "LOGIN_SMS", map[string]any{}, ipAddress, allowlistDecision.Flags())
	return result, nil
}

func (s Service) RequestResetSMSCode(ctx context.Context, token string) error {
	user, err := s.loadPasswordResetUser(ctx, hashToken(token))
	if err != nil {
		return err
	}
	if user.ID == "" || user.PasswordResetExpiry == nil || user.PasswordResetExpiry.Before(time.Now()) {
		return &requestError{status: 400, message: "Invalid or expired reset token"}
	}
	if !user.SMSMFAEnabled || !user.PhoneVerified || strings.TrimSpace(user.PhoneNumber) == "" {
		return &requestError{status: 400, message: "SMS MFA is not available for this account"}
	}

	return s.sendOTPToPhone(ctx, user.ID, user.PhoneNumber)
}

func (s Service) sendOTPToPhone(ctx context.Context, userID, phoneNumber string) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}
	hash := hashSMSCode(code)
	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsOtpHash" = $2,
		        "smsOtpExpiresAt" = $3,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		hash,
		time.Now().Add(smsOTPTTL),
	); err != nil {
		return fmt.Errorf("store sms otp: %w", err)
	}

	status := smsdelivery.StatusFromEnv()
	if err := smsdelivery.Send(ctx, smsdelivery.Message{
		To:   phoneNumber,
		Body: fmt.Sprintf("Your Arsenale verification code is: %s. It expires in 5 minutes.", code),
	}); err != nil {
		return err
	}

	if !status.Configured {
		log.Printf("authservice dev sms otp for user=%s phone=%s code=%s", userID, phoneNumber, code)
	}
	return nil
}

func (s Service) verifyOTP(ctx context.Context, userID, code string) (bool, error) {
	if s.DB == nil {
		return false, fmt.Errorf("postgres is not configured")
	}

	var (
		storedHash *string
		expiresAt  *time.Time
	)
	if err := s.DB.QueryRow(
		ctx,
		`SELECT "smsOtpHash", "smsOtpExpiresAt"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&storedHash, &expiresAt); err != nil {
		if err == pgx.ErrNoRows {
			return false, nil
		}
		return false, fmt.Errorf("load sms otp: %w", err)
	}
	if storedHash == nil || expiresAt == nil {
		return false, nil
	}
	if expiresAt.Before(time.Now()) {
		_, _ = s.DB.Exec(ctx, `UPDATE "User" SET "smsOtpHash" = NULL, "smsOtpExpiresAt" = NULL, "updatedAt" = NOW() WHERE id = $1`, userID)
		return false, nil
	}

	if *storedHash != hashSMSCode(code) {
		return false, nil
	}

	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsOtpHash" = NULL,
		        "smsOtpExpiresAt" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	); err != nil {
		return false, fmt.Errorf("clear sms otp: %w", err)
	}
	return true, nil
}

func (s Service) loadSMSMFAUser(ctx context.Context, userID string) (struct {
	ID            string
	SMSMFAEnabled bool
	PhoneNumber   string
}, error) {
	var user struct {
		ID            string
		SMSMFAEnabled bool
		PhoneNumber   string
	}
	err := s.DB.QueryRow(
		ctx,
		`SELECT id, COALESCE("smsMfaEnabled", false), COALESCE("phoneNumber", '')
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.SMSMFAEnabled, &user.PhoneNumber)
	if err != nil {
		if err == pgx.ErrNoRows {
			return user, &requestError{status: 401, message: "Invalid or expired temporary token"}
		}
		return user, fmt.Errorf("load sms mfa user: %w", err)
	}
	return user, nil
}

func generateOTPCode() (string, error) {
	const max = 1_000_000
	const limit = ^uint32(0) - (^uint32(0) % max)
	for {
		var raw [4]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return "", fmt.Errorf("generate otp: %w", err)
		}
		value := uint32(raw[0])<<24 | uint32(raw[1])<<16 | uint32(raw[2])<<8 | uint32(raw[3])
		if value < limit {
			return fmt.Sprintf("%06d", value%max), nil
		}
	}
}

func hashSMSCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
