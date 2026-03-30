package mfaapi

import (
	"context"
	"strings"
)

func (s Service) SetupPhone(ctx context.Context, userID, phoneNumber string) error {
	phoneNumber = strings.TrimSpace(phoneNumber)
	if !validatePhoneNumber(phoneNumber) {
		return requestErr(400, "Invalid phone number. Use E.164 format (e.g. +1234567890)")
	}
	if err := s.storePhoneNumber(ctx, userID, phoneNumber); err != nil {
		return err
	}
	return s.sendOTPToPhone(ctx, userID, phoneNumber)
}

func (s Service) VerifyPhone(ctx context.Context, userID, code, ipAddress string) error {
	if err := validateTOTPCode(code); err != nil {
		return invalidCodeError()
	}

	valid, err := s.verifyOTP(ctx, userID, code)
	if err != nil {
		return err
	}
	if !valid {
		return requestErr(400, "Invalid or expired verification code")
	}

	if err := s.markPhoneVerified(ctx, userID); err != nil {
		return err
	}
	return s.insertAuditLog(ctx, userID, "SMS_PHONE_VERIFY", ipAddress)
}

func (s Service) EnableSMS(ctx context.Context, userID, ipAddress string) error {
	user, err := s.loadSMSUser(ctx, userID)
	if err != nil {
		return err
	}
	if strings.TrimSpace(user.PhoneNumber) == "" || !user.PhoneVerified {
		return requestErr(400, "Phone number must be verified before enabling SMS MFA")
	}
	if user.SMSMFAEnabled {
		return requestErr(400, "SMS MFA is already enabled")
	}

	if err := s.setSMSMFAEnabled(ctx, userID, true); err != nil {
		return err
	}
	return s.insertAuditLog(ctx, userID, "SMS_MFA_ENABLE", ipAddress)
}

func (s Service) SendDisableCode(ctx context.Context, userID string) error {
	user, err := s.loadSMSUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.SMSMFAEnabled || strings.TrimSpace(user.PhoneNumber) == "" {
		return requestErr(400, "SMS MFA is not enabled")
	}
	return s.sendOTPToPhone(ctx, userID, user.PhoneNumber)
}

func (s Service) DisableSMS(ctx context.Context, userID, code, ipAddress string) error {
	if err := validateTOTPCode(code); err != nil {
		return invalidCodeError()
	}

	user, err := s.loadSMSUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.SMSMFAEnabled {
		return requestErr(400, "SMS MFA is not enabled")
	}

	valid, err := s.verifyOTP(ctx, userID, code)
	if err != nil {
		return err
	}
	if !valid {
		return requestErr(400, "Invalid or expired verification code")
	}

	if err := s.clearSMSMFA(ctx, userID); err != nil {
		return err
	}
	return s.insertAuditLog(ctx, userID, "SMS_MFA_DISABLE", ipAddress)
}
