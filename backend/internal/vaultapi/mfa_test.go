package vaultapi

import (
	"testing"
	"time"
)

func TestTOTPCodeRoundTrip(t *testing.T) {
	t.Parallel()

	secret := "JBSWY3DPEHPK3PXP"
	now := time.Unix(1_700_000_000, 0).UTC()

	code, err := TOTPCodeForTime(secret, now)
	if err != nil {
		t.Fatalf("TOTPCodeForTime() error = %v", err)
	}
	if len(code) != 6 {
		t.Fatalf("len(code) = %d, want 6", len(code))
	}
	if !verifyTOTPCode(secret, code, now) {
		t.Fatalf("verifyTOTPCode() = false, want true")
	}
}

func TestParseTOTPCode(t *testing.T) {
	t.Parallel()

	if _, err := ParseTOTPCode("123456"); err != nil {
		t.Fatalf("ParseTOTPCode(valid) error = %v", err)
	}
	if _, err := ParseTOTPCode("12ab56"); err == nil {
		t.Fatalf("ParseTOTPCode(invalid) error = nil, want error")
	}
}
