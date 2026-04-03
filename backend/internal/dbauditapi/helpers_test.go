package dbauditapi

import (
	"strings"
	"testing"
)

func TestValidateSafeRegex(t *testing.T) {
	t.Run("accepts safe patterns after trimming", func(t *testing.T) {
		got, err := validateSafeRegex(` \bDROP\s+TABLE\b `, "firewall rule")
		if err != nil {
			t.Fatalf("validateSafeRegex() returned error: %v", err)
		}
		if got != `\bDROP\s+TABLE\b` {
			t.Fatalf("validateSafeRegex() = %q, want trimmed safe pattern", got)
		}
	})

	t.Run("rejects nested quantifiers", func(t *testing.T) {
		_, err := validateSafeRegex(`(a+)+$`, "firewall rule")
		if err == nil {
			t.Fatal("validateSafeRegex() unexpectedly accepted nested quantifiers")
		}
		if !strings.Contains(err.Error(), "pattern too long or contains nested quantifiers") {
			t.Fatalf("validateSafeRegex() error = %q", err.Error())
		}
	})

	t.Run("rejects invalid syntax", func(t *testing.T) {
		_, err := validateSafeRegex(`(`, "firewall rule")
		if err == nil {
			t.Fatal("validateSafeRegex() unexpectedly accepted invalid syntax")
		}
		if !strings.Contains(err.Error(), "Invalid regex firewall rule") {
			t.Fatalf("validateSafeRegex() error = %q", err.Error())
		}
	})

	t.Run("rejects overly long patterns", func(t *testing.T) {
		_, err := validateSafeRegex(strings.Repeat("a", maxRegexLength+1), "firewall rule")
		if err == nil {
			t.Fatal("validateSafeRegex() unexpectedly accepted oversized pattern")
		}
		if !strings.Contains(err.Error(), "pattern too long or contains nested quantifiers") {
			t.Fatalf("validateSafeRegex() error = %q", err.Error())
		}
	})
}
