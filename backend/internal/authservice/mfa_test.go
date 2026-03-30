package authservice

import (
	"testing"
	"time"
)

func TestVerifyTOTPAllowsCurrentCode(t *testing.T) {
	t.Parallel()

	secret := "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP"
	now := time.Unix(1774890240, 0).UTC()
	code := generateTOTPCode(mustDecodeTOTPSecret(t, secret), now.Unix()/30)
	if !verifyTOTP(secret, code, now) {
		t.Fatalf("expected TOTP code to verify")
	}
}

func TestValidateTOTPCodeRejectsInvalidValues(t *testing.T) {
	t.Parallel()

	for _, raw := range []string{"", "12345", "1234567", "12a456"} {
		if err := validateTOTPCode(raw); err == nil {
			t.Fatalf("expected %q to fail validation", raw)
		}
	}
}

func mustDecodeTOTPSecret(t *testing.T, secret string) []byte {
	t.Helper()
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		t.Fatalf("decodeTOTPSecret: %v", err)
	}
	return key
}
