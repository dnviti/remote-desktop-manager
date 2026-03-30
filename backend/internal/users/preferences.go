package users

import (
	"context"
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/modelgateway"
	"github.com/jackc/pgx/v5"
)

func (s Service) UpdateDomainProfile(ctx context.Context, userID string, patch domainProfilePatch, fields []string, ipAddress string) (domainProfile, error) {
	var result domainProfile
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, fmt.Errorf("begin update domain profile: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var encryptedPassword, passwordIV, passwordTag *string
	if patch.HasDomainPassword {
		switch {
		case patch.DomainPassword == nil || strings.TrimSpace(*patch.DomainPassword) == "":
			encryptedPassword = nil
			passwordIV = nil
			passwordTag = nil
		default:
			masterKey, err := s.getVaultMasterKey(ctx, userID)
			if err != nil {
				return result, err
			}
			if len(masterKey) == 0 {
				return result, errVaultLocked
			}
			ciphertext, iv, tag, err := modelgateway.EncryptAPIKey(*patch.DomainPassword, masterKey)
			if err != nil {
				return result, fmt.Errorf("encrypt domain password: %w", err)
			}
			encryptedPassword = &ciphertext
			passwordIV = &iv
			passwordTag = &tag
		}
	}

	var encryptedDomainPassword *string
	err = tx.QueryRow(
		ctx,
		`UPDATE "User"
		    SET "domainName" = CASE WHEN $2 THEN $3 ELSE "domainName" END,
		        "domainUsername" = CASE WHEN $4 THEN $5 ELSE "domainUsername" END,
		        "encryptedDomainPassword" = CASE WHEN $6 THEN $7 ELSE "encryptedDomainPassword" END,
		        "domainPasswordIV" = CASE WHEN $6 THEN $8 ELSE "domainPasswordIV" END,
		        "domainPasswordTag" = CASE WHEN $6 THEN $9 ELSE "domainPasswordTag" END,
		        "updatedAt" = NOW()
		  WHERE id = $1
		  RETURNING "domainName", "domainUsername", "encryptedDomainPassword"`,
		userID,
		patch.HasDomainName,
		patch.DomainName,
		patch.HasDomainUsername,
		patch.DomainUsername,
		patch.HasDomainPassword,
		encryptedPassword,
		passwordIV,
		passwordTag,
	).Scan(&result.DomainName, &result.DomainUsername, &encryptedDomainPassword)
	if err != nil {
		return domainProfile{}, err
	}

	result.HasDomainPassword = encryptedDomainPassword != nil && strings.TrimSpace(*encryptedDomainPassword) != ""
	if err := insertAuditLog(ctx, tx, userID, "DOMAIN_PROFILE_UPDATE", map[string]any{"fields": fields}, ipAddress); err != nil {
		return domainProfile{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return domainProfile{}, fmt.Errorf("commit update domain profile: %w", err)
	}

	return result, nil
}

func (s Service) GetDomainProfile(ctx context.Context, userID string) (domainProfile, error) {
	var result domainProfile
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	var encryptedDomainPassword *string
	err := s.DB.QueryRow(
		ctx,
		`SELECT "domainName", "domainUsername", "encryptedDomainPassword"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&result.DomainName, &result.DomainUsername, &encryptedDomainPassword)
	if err != nil {
		return domainProfile{}, err
	}

	result.HasDomainPassword = encryptedDomainPassword != nil && strings.TrimSpace(*encryptedDomainPassword) != ""
	return result, nil
}

func (s Service) ClearDomainProfile(ctx context.Context, userID, ipAddress string) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin clear domain profile: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(
		ctx,
		`UPDATE "User"
		    SET "domainName" = NULL,
		        "domainUsername" = NULL,
		        "encryptedDomainPassword" = NULL,
		        "domainPasswordIV" = NULL,
		        "domainPasswordTag" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
	)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}

	if err := insertAuditLog(ctx, tx, userID, "DOMAIN_PROFILE_CLEAR", map[string]any{}, ipAddress); err != nil {
		return err
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit clear domain profile: %w", err)
	}

	return nil
}

func (s Service) GetNotificationSchedule(ctx context.Context, userID string) (notificationSchedule, error) {
	var result notificationSchedule
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	err := s.DB.QueryRow(
		ctx,
		`SELECT "notifDndEnabled", "notifQuietHoursStart", "notifQuietHoursEnd", "notifQuietHoursTimezone"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(&result.DNDEnabled, &result.QuietHoursStart, &result.QuietHoursEnd, &result.QuietHoursTimezone)
	if err != nil {
		if err == pgx.ErrNoRows {
			return notificationSchedule{
				DNDEnabled: false,
			}, nil
		}
		return notificationSchedule{}, err
	}

	return result, nil
}

func (s Service) UpdateNotificationSchedule(ctx context.Context, userID string, patch notificationSchedulePatch) (notificationSchedule, error) {
	var result notificationSchedule
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	err := s.DB.QueryRow(
		ctx,
		`UPDATE "User"
		    SET "notifDndEnabled" = CASE WHEN $2 THEN $3 ELSE "notifDndEnabled" END,
		        "notifQuietHoursStart" = CASE WHEN $4 THEN $5 ELSE "notifQuietHoursStart" END,
		        "notifQuietHoursEnd" = CASE WHEN $6 THEN $7 ELSE "notifQuietHoursEnd" END,
		        "notifQuietHoursTimezone" = CASE WHEN $8 THEN $9 ELSE "notifQuietHoursTimezone" END,
		        "updatedAt" = NOW()
		  WHERE id = $1
		  RETURNING "notifDndEnabled", "notifQuietHoursStart", "notifQuietHoursEnd", "notifQuietHoursTimezone"`,
		userID,
		patch.HasDNDEnabled,
		patch.DNDEnabled,
		patch.HasQuietHoursStart,
		patch.QuietHoursStart,
		patch.HasQuietHoursEnd,
		patch.QuietHoursEnd,
		patch.HasQuietHoursTimezone,
		patch.QuietHoursTimezone,
	).Scan(&result.DNDEnabled, &result.QuietHoursStart, &result.QuietHoursEnd, &result.QuietHoursTimezone)
	if err != nil {
		return notificationSchedule{}, err
	}

	return result, nil
}
