package mfaapi

import (
	"context"
	"fmt"
	"strings"

	"github.com/google/uuid"
)

func (s Service) RenameWebAuthnCredential(ctx context.Context, userID, credentialID, friendlyName string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	if _, err := uuid.Parse(strings.TrimSpace(credentialID)); err != nil {
		return requestErr(400, "invalid credential id")
	}
	friendlyName = strings.TrimSpace(friendlyName)
	if friendlyName == "" || len(friendlyName) > 64 {
		return requestErr(400, "friendlyName must be between 1 and 64 characters")
	}

	command, err := s.DB.Exec(
		ctx,
		`UPDATE "WebAuthnCredential"
		    SET "friendlyName" = $3
		  WHERE id = $1 AND "userId" = $2`,
		credentialID,
		userID,
		friendlyName,
	)
	if err != nil {
		return fmt.Errorf("rename webauthn credential: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "Credential not found")
	}
	return nil
}

func (s Service) RemoveWebAuthnCredential(ctx context.Context, userID, credentialID, ipAddress string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	if _, err := uuid.Parse(strings.TrimSpace(credentialID)); err != nil {
		return requestErr(400, "invalid credential id")
	}

	command, err := s.DB.Exec(
		ctx,
		`DELETE FROM "WebAuthnCredential"
		  WHERE id = $1 AND "userId" = $2`,
		credentialID,
		userID,
	)
	if err != nil {
		return fmt.Errorf("delete webauthn credential: %w", err)
	}
	if command.RowsAffected() == 0 {
		return requestErr(404, "Credential not found")
	}

	var remaining int
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COUNT(*)::int
		   FROM "WebAuthnCredential"
		  WHERE "userId" = $1`,
		userID,
	).Scan(&remaining); err != nil {
		return fmt.Errorf("count remaining webauthn credentials: %w", err)
	}

	if remaining == 0 {
		if _, err := s.DB.Exec(
			ctx,
			`UPDATE "User"
			    SET "webauthnEnabled" = false,
			        "updatedAt" = NOW()
			  WHERE id = $1`,
			userID,
		); err != nil {
			return fmt.Errorf("disable webauthn flag: %w", err)
		}
	}

	if err := s.insertAuditLog(ctx, userID, "WEBAUTHN_REMOVE", ipAddress); err != nil {
		return err
	}
	return nil
}
