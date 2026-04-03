package vaultapi

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
)

func (s Service) RequestWebAuthnOptions(ctx context.Context, userID string) (webauthnflow.AuthenticationOptions, error) {
	if err := s.enforceVaultMFARateLimit(ctx, userID); err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}

	masterKey, err := s.loadVaultRecovery(ctx, userID)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	if len(masterKey) == 0 {
		return webauthnflow.AuthenticationOptions{}, &requestError{status: http.StatusForbidden, message: "MFA vault recovery unavailable. Please use your password."}
	}
	defer zeroBytes(masterKey)

	descriptors, err := s.loadWebAuthnDescriptors(ctx, userID)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}

	flow := webauthnflow.New(s.Redis)
	options, err := flow.BuildAuthenticationOptions(descriptors)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	if err := flow.StoreChallenge(ctx, userID, options.Challenge); err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	return options, nil
}

func (s Service) UnlockWithWebAuthn(ctx context.Context, userID string, rawCredential json.RawMessage, fallbackChallenge, ipAddress string) (map[string]any, error) {
	if len(rawCredential) == 0 {
		return nil, &requestError{status: http.StatusBadRequest, message: "WebAuthn credential is required."}
	}
	if err := s.enforceVaultMFARateLimit(ctx, userID); err != nil {
		return nil, err
	}

	masterKey, err := s.loadVaultRecovery(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(masterKey) == 0 {
		return nil, &requestError{status: http.StatusForbidden, message: "MFA vault recovery unavailable. Please use your password."}
	}
	defer zeroBytes(masterKey)

	credentials, err := s.loadStoredWebAuthnCredentials(ctx, userID)
	if err != nil {
		return nil, err
	}

	challenge, err := s.resolveWebAuthnChallenge(ctx, userID, fallbackChallenge)
	if err != nil {
		return nil, err
	}

	verification, err := webauthnflow.VerifyAuthentication(rawCredential, challenge, credentials)
	if err != nil {
		return nil, mapVaultWebAuthnError(err)
	}
	if err := s.recordWebAuthnUsage(ctx, userID, verification); err != nil {
		return nil, err
	}

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return nil, err
	}
	if err := s.publishVaultStatus(ctx, userID, true); err != nil {
		return nil, err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_UNLOCK", map[string]any{"method": "webauthn"}, ipAddress); err != nil {
		return nil, err
	}
	return map[string]any{"unlocked": true}, nil
}

func (s Service) resolveWebAuthnChallenge(ctx context.Context, userID, fallbackChallenge string) (string, error) {
	flow := webauthnflow.New(s.Redis)
	challenge, err := flow.TakeChallenge(ctx, userID)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(challenge) == "" {
		challenge = strings.TrimSpace(fallbackChallenge)
	}
	if strings.TrimSpace(challenge) == "" {
		return "", &requestError{status: http.StatusBadRequest, message: "Challenge expired or not found. Please try again."}
	}
	return challenge, nil
}

func mapVaultWebAuthnError(err error) error {
	switch {
	case errors.Is(err, webauthnflow.ErrChallengeNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Challenge expired or not found. Please try again."}
	case errors.Is(err, webauthnflow.ErrCredentialNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Credential not found."}
	default:
		return &requestError{status: http.StatusUnauthorized, message: "WebAuthn authentication failed."}
	}
}

func (s Service) recordWebAuthnUsage(ctx context.Context, userID string, verification webauthnflow.VerifiedAuthentication) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "WebAuthnCredential"
		    SET counter = $3,
		        "lastUsedAt" = $4
		  WHERE "userId" = $1
		    AND "credentialId" = $2`,
		userID,
		verification.CredentialID,
		int64(verification.Counter),
		time.Now(),
	); err != nil {
		return fmt.Errorf("update webauthn credential usage: %w", err)
	}
	return nil
}
