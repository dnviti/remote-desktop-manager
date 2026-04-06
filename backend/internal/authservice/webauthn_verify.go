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

func (s Service) VerifyWebAuthn(ctx context.Context, tempToken string, rawCredential json.RawMessage, fallbackChallenge, ipAddress, userAgent string) (issuedLogin, error) {
	if s.DB == nil {
		return issuedLogin{}, fmt.Errorf("postgres is not configured")
	}
	if len(rawCredential) == 0 {
		return issuedLogin{}, &requestError{status: http.StatusBadRequest, message: "WebAuthn credential is required."}
	}

	claims, err := s.parseTempTokenClaims(tempToken)
	if err != nil {
		return issuedLogin{}, err
	}
	userID := stringClaim(claims, "userId")
	purpose := stringClaim(claims, "purpose")
	if purpose != "mfa-verify" {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}
	if stringClaim(claims, "primaryMethod") == primaryMethodPasskey {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Passkey is already the primary sign-in method for this login"}
	}
	if err := s.enforceLoginMFARateLimit(ctx, userID, ipAddress); err != nil {
		return issuedLogin{}, err
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA verification failed"}
		}
		return issuedLogin{}, err
	}
	if !user.WebAuthnEnabled {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA verification failed"}
	}

	credentials, err := s.loadStoredWebAuthnCredentials(ctx, user.ID)
	if err != nil {
		return issuedLogin{}, err
	}
	if len(credentials) == 0 {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA verification failed"}
	}

	challenge, err := s.resolveWebAuthnChallenge(ctx, user.ID, fallbackChallenge)
	if err != nil {
		return issuedLogin{}, err
	}

	verification, err := webauthnflow.VerifyAuthentication(rawCredential, challenge, credentials)
	if err != nil {
		return issuedLogin{}, s.mapWebAuthnAuthError(err)
	}

	if err := s.recordWebAuthnUsage(ctx, user.ID, verification); err != nil {
		return issuedLogin{}, err
	}

	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return issuedLogin{}, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, err
	}
	_ = s.insertStandaloneAuditLogWithFlags(ctx, &user.ID, "LOGIN_WEBAUTHN", map[string]any{}, ipAddress, allowlistDecision.Flags())
	return result, nil
}

func (s Service) loadStoredWebAuthnCredentials(ctx context.Context, userID string) ([]webauthnflow.StoredCredential, error) {
	rows, err := s.DB.Query(
		ctx,
		`SELECT "credentialId", "publicKey", counter
		   FROM "WebAuthnCredential"
		  WHERE "userId" = $1
		  ORDER BY "createdAt" DESC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("load webauthn credentials: %w", err)
	}
	defer rows.Close()

	result := make([]webauthnflow.StoredCredential, 0)
	for rows.Next() {
		var (
			credentialID string
			publicKey    string
			counter      int64
		)
		if err := rows.Scan(&credentialID, &publicKey, &counter); err != nil {
			return nil, fmt.Errorf("scan webauthn credential: %w", err)
		}
		result = append(result, webauthnflow.StoredCredential{
			CredentialID: strings.TrimSpace(credentialID),
			PublicKey:    strings.TrimSpace(publicKey),
			Counter:      uint32(max(counter, 0)),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate webauthn credentials: %w", err)
	}
	return result, nil
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

func (s Service) mapWebAuthnAuthError(err error) error {
	switch {
	case errors.Is(err, webauthnflow.ErrChallengeNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Challenge expired or not found. Please try again."}
	case errors.Is(err, webauthnflow.ErrCredentialNotFound):
		return &requestError{status: http.StatusBadRequest, message: "Credential not found."}
	default:
		return &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA verification failed"}
	}
}

func (s Service) recordWebAuthnUsage(ctx context.Context, userID string, verification webauthnflow.VerifiedAuthentication) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
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

func max(value, floor int64) int64 {
	if value < floor {
		return floor
	}
	return value
}
