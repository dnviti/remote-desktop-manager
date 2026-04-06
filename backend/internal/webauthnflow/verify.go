package webauthnflow

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/protocol/webauthncose"
	gowebauthn "github.com/go-webauthn/webauthn/webauthn"
	"github.com/google/uuid"
)

var ErrChallengeNotFound = errors.New("challenge expired or not found")
var ErrCredentialNotFound = errors.New("credential not found")

type StoredCredential struct {
	CredentialID string
	PublicKey    string
	Counter      uint32
}

type VerifiedAuthentication struct {
	CredentialID    string
	Counter         uint32
	CloneWarning    bool
	UserPresent     bool
	UserVerified    bool
	BackupEligible  bool
	BackupState     bool
	AuthenticatorID string
}

type RegisteredCredential struct {
	CredentialID string
	PublicKey    string
	Counter      uint32
	Transports   []string
	DeviceType   *string
	BackedUp     bool
	AAGUID       *string
}

type rpConfig struct {
	rpID     string
	rpOrigin string
}

func VerifyAuthentication(rawCredential []byte, challenge string, credentials []StoredCredential) (VerifiedAuthentication, error) {
	challenge = strings.TrimSpace(challenge)
	if challenge == "" {
		return VerifiedAuthentication{}, ErrChallengeNotFound
	}

	parsed, err := protocol.ParseCredentialRequestResponseBytes(rawCredential)
	if err != nil {
		return VerifiedAuthentication{}, fmt.Errorf("parse credential assertion: %w", err)
	}

	credentialID := strings.TrimSpace(base64.RawURLEncoding.EncodeToString(parsed.RawID))
	stored, found := findStoredCredential(strings.TrimSpace(parsed.ID), credentialID, credentials)
	if !found {
		return VerifiedAuthentication{}, ErrCredentialNotFound
	}

	publicKey, err := decodeBase64URL(stored.PublicKey)
	if err != nil {
		return VerifiedAuthentication{}, fmt.Errorf("decode stored public key: %w", err)
	}

	cfg := loadRPConfig()
	if err := parsed.Verify(
		challenge,
		cfg.rpID,
		[]string{cfg.rpOrigin},
		nil,
		protocol.TopOriginIgnoreVerificationMode,
		"",
		false,
		true,
		publicKey,
	); err != nil {
		return VerifiedAuthentication{}, fmt.Errorf("verify credential assertion: %w", err)
	}

	nextCounter := stored.Counter
	cloneWarning := false
	assertionCounter := parsed.Response.AuthenticatorData.Counter
	if assertionCounter <= stored.Counter && (assertionCounter != 0 || stored.Counter != 0) {
		cloneWarning = true
	} else {
		nextCounter = assertionCounter
	}

	return VerifiedAuthentication{
		CredentialID:    stored.CredentialID,
		Counter:         nextCounter,
		CloneWarning:    cloneWarning,
		UserPresent:     parsed.Response.AuthenticatorData.Flags.HasUserPresent(),
		UserVerified:    parsed.Response.AuthenticatorData.Flags.HasUserVerified(),
		BackupEligible:  parsed.Response.AuthenticatorData.Flags.HasBackupEligible(),
		BackupState:     parsed.Response.AuthenticatorData.Flags.HasBackupState(),
		AuthenticatorID: credentialID,
	}, nil
}

func ExtractAuthenticationCredentialIDs(rawCredential []byte) (string, string, error) {
	parsed, err := protocol.ParseCredentialRequestResponseBytes(rawCredential)
	if err != nil {
		return "", "", fmt.Errorf("parse credential assertion: %w", err)
	}
	return strings.TrimSpace(parsed.ID), strings.TrimSpace(base64.RawURLEncoding.EncodeToString(parsed.RawID)), nil
}

func VerifyRegistration(rawCredential []byte, challenge string) (RegisteredCredential, error) {
	challenge = strings.TrimSpace(challenge)
	if challenge == "" {
		return RegisteredCredential{}, ErrChallengeNotFound
	}

	parsed, err := protocol.ParseCredentialCreationResponseBytes(rawCredential)
	if err != nil {
		return RegisteredCredential{}, fmt.Errorf("parse credential creation: %w", err)
	}

	cfg := loadRPConfig()
	clientDataHash, err := parsed.Verify(
		challenge,
		false,
		true,
		cfg.rpID,
		[]string{cfg.rpOrigin},
		nil,
		protocol.TopOriginIgnoreVerificationMode,
		nil,
		defaultCredentialParameters(),
	)
	if err != nil {
		return RegisteredCredential{}, fmt.Errorf("verify credential creation: %w", err)
	}

	credential, err := gowebauthn.NewCredential(clientDataHash, parsed)
	if err != nil {
		return RegisteredCredential{}, fmt.Errorf("build credential record: %w", err)
	}

	return RegisteredCredential{
		CredentialID: base64.RawURLEncoding.EncodeToString(credential.ID),
		PublicKey:    base64.RawURLEncoding.EncodeToString(credential.PublicKey),
		Counter:      credential.Authenticator.SignCount,
		Transports:   transportStrings(credential.Transport),
		DeviceType:   deriveDeviceType(credential.Flags.BackupEligible),
		BackedUp:     credential.Flags.BackupState,
		AAGUID:       formatAAGUID(credential.Authenticator.AAGUID),
	}, nil
}

func loadRPConfig() rpConfig {
	rpID := strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ID"))
	if rpID == "" {
		rpID = "localhost"
	}
	rpOrigin := strings.TrimSpace(os.Getenv("WEBAUTHN_RP_ORIGIN"))
	if rpOrigin == "" {
		rpOrigin = "https://localhost:3000"
	}
	return rpConfig{
		rpID:     rpID,
		rpOrigin: rpOrigin,
	}
}

func defaultCredentialParameters() []protocol.CredentialParameter {
	return []protocol.CredentialParameter{
		{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgEdDSA},
		{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgES256},
		{Type: protocol.PublicKeyCredentialType, Algorithm: webauthncose.AlgRS256},
	}
}

func findStoredCredential(parsedID, rawID string, credentials []StoredCredential) (StoredCredential, bool) {
	for _, credential := range credentials {
		if strings.TrimSpace(credential.CredentialID) == parsedID || strings.TrimSpace(credential.CredentialID) == rawID {
			return credential, true
		}
	}
	return StoredCredential{}, false
}

func decodeBase64URL(value string) ([]byte, error) {
	return base64.RawURLEncoding.DecodeString(strings.TrimSpace(value))
}

func transportStrings(transports []protocol.AuthenticatorTransport) []string {
	if len(transports) == 0 {
		return []string{}
	}
	result := make([]string, 0, len(transports))
	for _, transport := range transports {
		result = append(result, string(transport))
	}
	return result
}

func deriveDeviceType(backupEligible bool) *string {
	deviceType := "singleDevice"
	if backupEligible {
		deviceType = "multiDevice"
	}
	return &deviceType
}

func formatAAGUID(raw []byte) *string {
	if len(raw) != 16 {
		return nil
	}
	value, err := uuid.FromBytes(raw)
	if err != nil {
		return nil
	}
	formatted := value.String()
	return &formatted
}

func OptionsMetadata(options AuthenticationOptions) (map[string]interface{}, error) {
	raw, err := json.Marshal(options)
	if err != nil {
		return nil, fmt.Errorf("marshal webauthn options: %w", err)
	}
	var metadata map[string]interface{}
	if err := json.Unmarshal(raw, &metadata); err != nil {
		return nil, fmt.Errorf("unmarshal webauthn options metadata: %w", err)
	}
	return metadata, nil
}
