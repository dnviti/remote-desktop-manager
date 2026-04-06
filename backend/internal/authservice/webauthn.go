package authservice

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
	"github.com/jackc/pgx/v5"
)

func (s Service) RequestWebAuthnOptions(ctx context.Context, tempToken string) (webauthnflow.AuthenticationOptions, error) {
	claims, err := s.parseTempTokenClaims(tempToken)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	userID := stringClaim(claims, "userId")
	purpose := stringClaim(claims, "purpose")
	if purpose != "mfa-verify" {
		return webauthnflow.AuthenticationOptions{}, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}
	if stringClaim(claims, "primaryMethod") == primaryMethodPasskey {
		return webauthnflow.AuthenticationOptions{}, &requestError{status: http.StatusUnauthorized, message: "Passkey is already the primary sign-in method for this login"}
	}

	user, err := s.loadWebAuthnAuthUser(ctx, userID)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	if !user.enabled {
		return webauthnflow.AuthenticationOptions{}, &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA is not available"}
	}

	flow := webauthnflow.New(s.Redis)
	options, err := flow.BuildAuthenticationOptions(user.credentials)
	if err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	if err := flow.StoreChallenge(ctx, userID, options.Challenge); err != nil {
		return webauthnflow.AuthenticationOptions{}, err
	}
	return options, nil
}

type webauthnAuthUser struct {
	enabled     bool
	credentials []webauthnflow.CredentialDescriptor
}

func (s Service) loadWebAuthnAuthUser(ctx context.Context, userID string) (webauthnAuthUser, error) {
	if s.DB == nil {
		return webauthnAuthUser{}, fmt.Errorf("postgres is not configured")
	}

	var enabled bool
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE("webauthnEnabled", false)
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&enabled); err != nil {
		if err == pgx.ErrNoRows {
			return webauthnAuthUser{}, &requestError{status: http.StatusUnauthorized, message: "WebAuthn MFA is not available"}
		}
		return webauthnAuthUser{}, fmt.Errorf("load webauthn mfa user: %w", err)
	}

	rows, err := s.DB.Query(
		ctx,
		`SELECT "credentialId", transports
		   FROM "WebAuthnCredential"
		  WHERE "userId" = $1
		  ORDER BY "createdAt" DESC`,
		userID,
	)
	if err != nil {
		return webauthnAuthUser{}, fmt.Errorf("load webauthn credentials: %w", err)
	}
	defer rows.Close()

	credentials := make([]webauthnflow.CredentialDescriptor, 0)
	for rows.Next() {
		var (
			credentialID string
			transports   []string
		)
		if err := rows.Scan(&credentialID, &transports); err != nil {
			return webauthnAuthUser{}, fmt.Errorf("scan webauthn credential: %w", err)
		}
		credentials = append(credentials, webauthnflow.CredentialDescriptor{
			ID:         strings.TrimSpace(credentialID),
			Type:       "public-key",
			Transports: transports,
		})
	}
	if err := rows.Err(); err != nil {
		return webauthnAuthUser{}, fmt.Errorf("iterate webauthn credentials: %w", err)
	}

	return webauthnAuthUser{
		enabled:     enabled && len(credentials) > 0,
		credentials: credentials,
	}, nil
}
