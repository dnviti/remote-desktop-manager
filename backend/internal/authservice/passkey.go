package authservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
	"github.com/jackc/pgx/v5"
)

func (s Service) RequestPasskeyOptions(ctx context.Context) (webauthnflow.AuthenticationOptions, string, error) {
	flow := webauthnflow.New(s.Redis)
	options, err := flow.BuildAuthenticationOptions(nil)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, "", err
	}
	tempToken, err := s.issueTempTokenWithClaims(map[string]any{
		"purpose":   "passkey-login",
		"challenge": options.Challenge,
	}, 5*time.Minute)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, "", err
	}
	return options, tempToken, nil
}

func (s Service) VerifyPasskey(ctx context.Context, tempToken string, rawCredential json.RawMessage, fallbackChallenge, ipAddress, userAgent string) (loginFlow, error) {
	if s.DB == nil {
		return loginFlow{}, fmt.Errorf("postgres is not configured")
	}
	if len(rawCredential) == 0 {
		return loginFlow{}, &requestError{status: http.StatusBadRequest, message: "WebAuthn credential is required."}
	}
	if err := s.enforceLoginRateLimit(ctx, ipAddress); err != nil {
		return loginFlow{}, err
	}

	claims, err := s.parseTempTokenClaims(tempToken)
	if err != nil {
		return loginFlow{}, err
	}
	if stringClaim(claims, "purpose") != "passkey-login" {
		return loginFlow{}, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}
	challenge := stringClaim(claims, "challenge")
	if challenge == "" {
		challenge = strings.TrimSpace(fallbackChallenge)
	}
	if challenge == "" {
		return loginFlow{}, &requestError{status: http.StatusBadRequest, message: "Challenge expired or not found. Please try again."}
	}

	parsedID, rawID, err := webauthnflow.ExtractAuthenticationCredentialIDs(rawCredential)
	if err != nil {
		return loginFlow{}, &requestError{status: http.StatusBadRequest, message: "WebAuthn authentication failed"}
	}

	user, storedCredential, err := s.loadPasskeyUser(ctx, parsedID, rawID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return loginFlow{}, &requestError{status: http.StatusUnauthorized, message: "Passkey authentication failed"}
		}
		return loginFlow{}, err
	}
	if !user.Enabled {
		return loginFlow{}, &requestError{status: http.StatusUnauthorized, message: "Passkey authentication failed"}
	}

	verification, err := webauthnflow.VerifyAuthentication(rawCredential, challenge, []webauthnflow.StoredCredential{storedCredential})
	if err != nil {
		return loginFlow{}, mapPasskeyAuthError(err)
	}
	if err := s.recordWebAuthnUsage(ctx, user.ID, verification); err != nil {
		return loginFlow{}, err
	}

	flow, err := s.finalizePrimaryLogin(ctx, user, primaryMethodPasskey, ipAddress, userAgent)
	if err != nil {
		return loginFlow{}, err
	}
	return flow, nil
}

func mapPasskeyAuthError(err error) error {
	switch {
	case errors.Is(err, webauthnflow.ErrChallengeNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Challenge expired or not found. Please try again."}
	case errors.Is(err, webauthnflow.ErrCredentialNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Credential not found."}
	default:
		return &requestError{status: http.StatusUnauthorized, message: "Passkey authentication failed"}
	}
}

func (s Service) loadPasskeyUser(ctx context.Context, parsedCredentialID, rawCredentialID string) (loginUser, webauthnflow.StoredCredential, error) {
	var (
		userID       string
		credentialID string
		publicKey    string
		counter      int64
	)
	err := s.DB.QueryRow(
		ctx,
		`SELECT "userId", "credentialId", "publicKey", counter
		   FROM "WebAuthnCredential"
		  WHERE "credentialId" = $1
		     OR "credentialId" = $2
		  ORDER BY "createdAt" DESC
		  LIMIT 1`,
		parsedCredentialID,
		rawCredentialID,
	).Scan(&userID, &credentialID, &publicKey, &counter)
	if err != nil {
		return loginUser{}, webauthnflow.StoredCredential{}, err
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return loginUser{}, webauthnflow.StoredCredential{}, err
	}
	return user, webauthnflow.StoredCredential{
		CredentialID: strings.TrimSpace(credentialID),
		PublicKey:    strings.TrimSpace(publicKey),
		Counter:      uint32(max(counter, 0)),
	}, nil
}
