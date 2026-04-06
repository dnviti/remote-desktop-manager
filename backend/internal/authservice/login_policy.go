package authservice

import (
	"context"
	"strings"
	"time"
)

const (
	loginMFAMethodEmail    = "email"
	loginMFAMethodTOTP     = "totp"
	loginMFAMethodSMS      = "sms"
	loginMFAMethodWebAuthn = "webauthn"
	primaryMethodPassword  = "password"
	primaryMethodPasskey   = "passkey"
)

func (s Service) effectiveLoginMFAMethods(user loginUser, primaryMethod string) []string {
	if user.ActiveTenant == nil || !user.ActiveTenant.MFARequired {
		return nil
	}

	methods := make([]string, 0, 4)
	if emailFlowConfigured() && user.EmailVerified && strings.TrimSpace(user.Email) != "" {
		methods = append(methods, loginMFAMethodEmail)
	}
	if user.TOTPEnabled {
		methods = append(methods, loginMFAMethodTOTP)
	}
	if user.SMSMFAEnabled && user.PhoneVerified && strings.TrimSpace(user.PhoneNumber) != "" {
		methods = append(methods, loginMFAMethodSMS)
	}
	if primaryMethod != primaryMethodPasskey && user.WebAuthnEnabled {
		methods = append(methods, loginMFAMethodWebAuthn)
	}
	return methods
}

func (s Service) finalizePrimaryLogin(ctx context.Context, user loginUser, primaryMethod, ipAddress, userAgent string) (loginFlow, error) {
	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return loginFlow{}, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}

	mfaMethods := s.effectiveLoginMFAMethods(user, primaryMethod)
	if len(mfaMethods) > 0 {
		tempToken, err := s.issueTempTokenWithClaims(map[string]any{
			"userId":        user.ID,
			"purpose":       "mfa-verify",
			"primaryMethod": primaryMethod,
		}, 5*time.Minute)
		if err != nil {
			return loginFlow{}, err
		}
		return loginFlow{
			requiresMFA:  true,
			requiresTOTP: containsString(mfaMethods, loginMFAMethodTOTP),
			methods:      mfaMethods,
			tempToken:    tempToken,
		}, nil
	}

	if requiresTenantMFASetup(user, primaryMethod) {
		tempToken, err := s.issueTempToken(user.ID, "mfa-setup", 15*time.Minute)
		if err != nil {
			return loginFlow{}, err
		}
		return loginFlow{
			mfaSetupRequired: true,
			tempToken:        tempToken,
		}, nil
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return loginFlow{}, err
	}
	_ = s.insertStandaloneAuditLogWithFlags(ctx, &user.ID, "LOGIN", map[string]any{
		"primaryMethod": primaryMethod,
	}, ipAddress, allowlistDecision.Flags())
	return loginFlow{issued: &result}, nil
}

func containsString(items []string, target string) bool {
	for _, item := range items {
		if item == target {
			return true
		}
	}
	return false
}

func requiresTenantMFASetup(user loginUser, primaryMethod string) bool {
	return user.ActiveTenant != nil &&
		user.ActiveTenant.MFARequired &&
		primaryMethod == primaryMethodPassword
}
