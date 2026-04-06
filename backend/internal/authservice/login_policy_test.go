package authservice

import "testing"

func TestEffectiveLoginMFAMethodsRespectTenantRequirement(t *testing.T) {
	t.Setenv("SMTP_HOST", "smtp.example.test")

	service := Service{}
	user := loginUser{
		Email:           "admin@example.com",
		EmailVerified:   true,
		TOTPEnabled:     true,
		SMSMFAEnabled:   true,
		PhoneNumber:     "+15551234567",
		PhoneVerified:   true,
		WebAuthnEnabled: true,
		ActiveTenant:    &loginMembership{MFARequired: false},
	}

	methods := service.effectiveLoginMFAMethods(user, primaryMethodPassword)
	if len(methods) != 0 {
		t.Fatalf("expected no MFA methods when tenant does not require MFA, got %v", methods)
	}
}

func TestEffectiveLoginMFAMethodsFilterPasskeyAsSecondaryFactor(t *testing.T) {
	t.Setenv("SMTP_HOST", "smtp.example.test")

	service := Service{}
	user := loginUser{
		Email:           "admin@example.com",
		EmailVerified:   true,
		TOTPEnabled:     true,
		SMSMFAEnabled:   true,
		PhoneNumber:     "+15551234567",
		PhoneVerified:   true,
		WebAuthnEnabled: true,
		ActiveTenant:    &loginMembership{MFARequired: true},
	}

	methods := service.effectiveLoginMFAMethods(user, primaryMethodPasskey)
	if containsString(methods, loginMFAMethodWebAuthn) {
		t.Fatalf("expected passkey-primary flow to exclude webauthn MFA, got %v", methods)
	}
	if !containsString(methods, loginMFAMethodEmail) || !containsString(methods, loginMFAMethodTOTP) || !containsString(methods, loginMFAMethodSMS) {
		t.Fatalf("expected email, totp, and sms MFA methods, got %v", methods)
	}
}

func TestRequiresTenantMFASetupSkipsPasskeyPrimary(t *testing.T) {
	user := loginUser{
		ActiveTenant: &loginMembership{MFARequired: true},
	}

	if !requiresTenantMFASetup(user, primaryMethodPassword) {
		t.Fatalf("expected password-primary login to require MFA setup when tenant policy requires MFA")
	}
	if requiresTenantMFASetup(user, primaryMethodPasskey) {
		t.Fatalf("expected passkey-primary login to bypass MFA setup when no secondary factors exist")
	}
}
