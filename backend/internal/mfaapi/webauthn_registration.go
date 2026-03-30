package mfaapi

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/webauthnflow"
	"github.com/jackc/pgx/v5"
)

func (s Service) GenerateWebAuthnRegistrationOptions(ctx context.Context, userID string) (webauthnflow.RegistrationOptions, error) {
	if s.DB == nil {
		return webauthnflow.RegistrationOptions{}, fmt.Errorf("database is unavailable")
	}

	var (
		email    string
		username *string
	)
	if err := s.DB.QueryRow(
		ctx,
		`SELECT email, username
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&email, &username); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return webauthnflow.RegistrationOptions{}, fmt.Errorf("user not found")
		}
		return webauthnflow.RegistrationOptions{}, fmt.Errorf("load webauthn registration user: %w", err)
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
		return webauthnflow.RegistrationOptions{}, fmt.Errorf("load existing webauthn credentials: %w", err)
	}
	defer rows.Close()

	existing := make([]webauthnflow.CredentialDescriptor, 0)
	for rows.Next() {
		var (
			credentialID string
			transports   []string
		)
		if err := rows.Scan(&credentialID, &transports); err != nil {
			return webauthnflow.RegistrationOptions{}, fmt.Errorf("scan webauthn credential: %w", err)
		}
		existing = append(existing, webauthnflow.CredentialDescriptor{
			ID:         strings.TrimSpace(credentialID),
			Type:       "public-key",
			Transports: transports,
		})
	}
	if err := rows.Err(); err != nil {
		return webauthnflow.RegistrationOptions{}, fmt.Errorf("iterate webauthn credentials: %w", err)
	}

	displayName := strings.TrimSpace(email)
	if username != nil && strings.TrimSpace(*username) != "" {
		displayName = strings.TrimSpace(*username)
	}

	flow := webauthnflow.New(s.Redis)
	options, err := flow.BuildRegistrationOptions(strings.TrimSpace(email), displayName, existing)
	if err != nil {
		return webauthnflow.RegistrationOptions{}, err
	}
	if err := flow.StoreChallenge(ctx, userID, options.Challenge); err != nil {
		return webauthnflow.RegistrationOptions{}, err
	}
	return options, nil
}
