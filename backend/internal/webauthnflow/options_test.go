package webauthnflow

import (
	"encoding/base64"
	"encoding/json"
	"testing"
)

func TestBuildRegistrationOptions(t *testing.T) {
	service := Service{RPID: "localhost", RPName: "Arsenale"}
	options, err := service.BuildRegistrationOptions("admin@example.com", "admin", nil)
	if err != nil {
		t.Fatalf("BuildRegistrationOptions() error = %v", err)
	}
	if options.RP.ID != "localhost" || options.RP.Name != "Arsenale" {
		t.Fatalf("unexpected relying party: %+v", options.RP)
	}
	if options.User.Name != "admin@example.com" || options.User.DisplayName != "admin" {
		t.Fatalf("unexpected user payload: %+v", options.User)
	}
	if len(options.Challenge) == 0 || len(options.User.ID) == 0 {
		t.Fatal("expected challenge and user handle")
	}
	if len(options.ExcludeCredentials) != 0 {
		t.Fatalf("expected empty exclude credentials, got %d", len(options.ExcludeCredentials))
	}
	if options.AuthenticatorSelection.ResidentKey != "required" {
		t.Fatalf("expected resident key to be required, got %q", options.AuthenticatorSelection.ResidentKey)
	}
	if !options.AuthenticatorSelection.RequireResidentKey {
		t.Fatal("expected resident key requirement to be enabled")
	}
	if options.AuthenticatorSelection.UserVerification != "required" {
		t.Fatalf("expected user verification to be required, got %q", options.AuthenticatorSelection.UserVerification)
	}
}

func TestBuildAuthenticationOptionsRequiresUserVerification(t *testing.T) {
	service := Service{RPID: "localhost", RPName: "Arsenale"}
	options, err := service.BuildAuthenticationOptions(nil)
	if err != nil {
		t.Fatalf("BuildAuthenticationOptions() error = %v", err)
	}
	if options.UserVerification != "required" {
		t.Fatalf("expected user verification to be required, got %q", options.UserVerification)
	}
}

func TestDecodeChallengePayloadSupportsNodeBase64JSON(t *testing.T) {
	raw, err := json.Marshal(storedChallenge{Challenge: "abc123"})
	if err != nil {
		t.Fatalf("json.Marshal() error = %v", err)
	}
	encoded := []byte(base64.StdEncoding.EncodeToString(raw))
	decoded, err := decodeChallengePayload(encoded)
	if err != nil {
		t.Fatalf("decodeChallengePayload() error = %v", err)
	}
	if decoded != "abc123" {
		t.Fatalf("decodeChallengePayload() = %q, want %q", decoded, "abc123")
	}
}
