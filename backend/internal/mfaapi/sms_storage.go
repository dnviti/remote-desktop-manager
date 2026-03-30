package mfaapi

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

type smsUser struct {
	ID            string
	SMSMFAEnabled bool
	PhoneNumber   string
	PhoneVerified bool
}

func (s Service) loadSMSUser(ctx context.Context, userID string) (smsUser, error) {
	if s.DB == nil {
		return smsUser{}, fmt.Errorf("database is unavailable")
	}

	var user smsUser
	if err := s.DB.QueryRow(
		ctx,
		`SELECT id, COALESCE("smsMfaEnabled", false), COALESCE("phoneNumber", ''), COALESCE("phoneVerified", false)
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&user.ID, &user.SMSMFAEnabled, &user.PhoneNumber, &user.PhoneVerified); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return smsUser{}, requestErr(404, "User not found")
		}
		return smsUser{}, fmt.Errorf("load sms user: %w", err)
	}
	return user, nil
}

func (s Service) storePhoneNumber(ctx context.Context, userID, phoneNumber string) error {
	command, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "phoneNumber" = $2,
		        "phoneVerified" = false,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		strings.TrimSpace(phoneNumber),
	)
	if err != nil {
		return fmt.Errorf("store phone number: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "User not found")
	}
	return nil
}

func (s Service) markPhoneVerified(ctx context.Context, userID string) error {
	command, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "phoneVerified" = true,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	)
	if err != nil {
		return fmt.Errorf("mark phone verified: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "User not found")
	}
	return nil
}

func (s Service) setSMSMFAEnabled(ctx context.Context, userID string, enabled bool) error {
	command, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsMfaEnabled" = $2,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		enabled,
	)
	if err != nil {
		return fmt.Errorf("set sms mfa enabled: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "User not found")
	}
	return nil
}

func (s Service) clearSMSMFA(ctx context.Context, userID string) error {
	command, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsMfaEnabled" = false,
		        "phoneNumber" = NULL,
		        "phoneVerified" = false,
		        "smsOtpHash" = NULL,
		        "smsOtpExpiresAt" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	)
	if err != nil {
		return fmt.Errorf("clear sms mfa: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "User not found")
	}
	return nil
}

func (s Service) storeOTP(ctx context.Context, userID, code string) error {
	command, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsOtpHash" = $2,
		        "smsOtpExpiresAt" = $3,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		hashSMSCode(code),
		time.Now().Add(smsOTPTTL),
	)
	if err != nil {
		return fmt.Errorf("store sms otp: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "User not found")
	}
	return nil
}

func (s Service) verifyOTP(ctx context.Context, userID, code string) (bool, error) {
	if s.DB == nil {
		return false, fmt.Errorf("database is unavailable")
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
		if errors.Is(err, pgx.ErrNoRows) {
			return false, requestErr(404, "User not found")
		}
		return false, fmt.Errorf("load sms otp: %w", err)
	}

	if storedHash == nil || expiresAt == nil {
		return false, nil
	}
	if expiresAt.Before(time.Now()) {
		_, _ = s.DB.Exec(
			ctx,
			`UPDATE "User"
			    SET "smsOtpHash" = NULL,
			        "smsOtpExpiresAt" = NULL,
			        "updatedAt" = NOW()
			  WHERE id = $1`,
			userID,
		)
		return false, nil
	}
	if *storedHash != hashSMSCode(code) {
		return false, nil
	}

	_, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "smsOtpHash" = NULL,
		        "smsOtpExpiresAt" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	)
	if err != nil {
		return false, fmt.Errorf("clear sms otp: %w", err)
	}
	return true, nil
}
