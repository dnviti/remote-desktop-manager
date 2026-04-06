package authservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/ldapapi"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

func (s Service) tryLDAPLogin(ctx context.Context, email, password, ipAddress, userAgent string) (*loginFlow, error) {
	ldapUser, err := ldapapi.AuthenticateUser(ctx, email, password)
	if err != nil || ldapUser == nil {
		return nil, err
	}

	user, err := s.loadLoginUser(ctx, ldapUser.Email)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		if !ldapAutoProvisionEnabled() {
			return nil, nil
		}
		if err := s.provisionLDAPUser(ctx, *ldapUser, ipAddress); err != nil {
			return nil, err
		}
		user, err = s.loadLoginUser(ctx, ldapUser.Email)
		if err != nil {
			return nil, err
		}
	case err != nil:
		return nil, err
	default:
		if err := s.upsertLDAPAccount(ctx, user.ID, *ldapUser); err != nil {
			return nil, err
		}
	}

	if !user.Enabled {
		return nil, &requestError{status: 403, message: "Your account has been disabled. Contact your administrator."}
	}
	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return nil, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}
	if !user.WebAuthnEnabled {
		if err := s.storeVaultSession(ctx, user.ID, password, user); err != nil {
			return nil, err
		}
	}
	flow, err := s.finalizePrimaryLogin(ctx, user, primaryMethodPassword, ipAddress, userAgent)
	if err != nil {
		return nil, err
	}
	return &flow, nil
}

func (s Service) provisionLDAPUser(ctx context.Context, ldapUser ldapapi.AuthUser, ipAddress string) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}

	attributes, err := json.Marshal(map[string]any{
		"dn":     ldapUser.DN,
		"uid":    ldapUser.UID,
		"groups": ldapUser.Groups,
	})
	if err != nil {
		return fmt.Errorf("marshal ldap attributes: %w", err)
	}

	defaultTenantID := strings.TrimSpace(os.Getenv("LDAP_DEFAULT_TENANT_ID"))
	tenantExists := false
	if defaultTenantID != "" {
		if err := s.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM "Tenant" WHERE id = $1)`, defaultTenantID).Scan(&tenantExists); err != nil {
			return fmt.Errorf("check default ldap tenant: %w", err)
		}
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin ldap provision: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	userID := uuid.NewString()
	username := strings.TrimSpace(ldapUser.DisplayName)
	if username == "" {
		username = strings.TrimSpace(ldapUser.UID)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "User" (id, email, username, "vaultSetupComplete", "emailVerified")
		 VALUES ($1, $2, $3, false, true)`,
		userID,
		strings.ToLower(strings.TrimSpace(ldapUser.Email)),
		nullableString(username),
	); err != nil {
		return fmt.Errorf("create ldap user: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "OAuthAccount" (id, "userId", provider, "providerUserId", "providerEmail", "samlAttributes")
		 VALUES ($1, $2, 'LDAP', $3, $4, $5::jsonb)`,
		uuid.NewString(),
		userID,
		strings.TrimSpace(ldapUser.ProviderUserID),
		strings.ToLower(strings.TrimSpace(ldapUser.Email)),
		string(attributes),
	); err != nil {
		return fmt.Errorf("create ldap oauth account: %w", err)
	}

	if defaultTenantID != "" && tenantExists {
		if _, err := tx.Exec(
			ctx,
			`INSERT INTO "TenantMember" (id, "tenantId", "userId", role, status, "isActive")
			 VALUES ($1, $2, $3, 'MEMBER', 'ACCEPTED', false)
			 ON CONFLICT ("tenantId", "userId") DO NOTHING`,
			uuid.NewString(),
			defaultTenantID,
			userID,
		); err != nil {
			return fmt.Errorf("assign ldap default tenant: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit ldap provision: %w", err)
	}

	_ = s.insertStandaloneAuditLog(ctx, &userID, "LDAP_USER_CREATED", map[string]any{
		"email": ldapUser.Email,
		"uid":   ldapUser.UID,
		"dn":    ldapUser.DN,
	}, ipAddress)
	return nil
}

func (s Service) upsertLDAPAccount(ctx context.Context, userID string, ldapUser ldapapi.AuthUser) error {
	if s.DB == nil {
		return fmt.Errorf("postgres is not configured")
	}

	attributes, err := json.Marshal(map[string]any{
		"dn":     ldapUser.DN,
		"uid":    ldapUser.UID,
		"groups": ldapUser.Groups,
	})
	if err != nil {
		return fmt.Errorf("marshal ldap attributes: %w", err)
	}

	var accountID string
	err = s.DB.QueryRow(
		ctx,
		`SELECT id
		   FROM "OAuthAccount"
		  WHERE "userId" = $1
		    AND provider = 'LDAP'`,
		userID,
	).Scan(&accountID)
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		_, err = s.DB.Exec(
			ctx,
			`INSERT INTO "OAuthAccount" (id, "userId", provider, "providerUserId", "providerEmail", "samlAttributes")
			 VALUES ($1, $2, 'LDAP', $3, $4, $5::jsonb)`,
			uuid.NewString(),
			userID,
			strings.TrimSpace(ldapUser.ProviderUserID),
			strings.ToLower(strings.TrimSpace(ldapUser.Email)),
			string(attributes),
		)
		if err != nil {
			return fmt.Errorf("create ldap oauth account: %w", err)
		}
		return nil
	case err != nil:
		return fmt.Errorf("load ldap oauth account: %w", err)
	}

	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "OAuthAccount"
		    SET "providerUserId" = $2,
		        "providerEmail" = $3,
		        "samlAttributes" = $4::jsonb
		  WHERE id = $1`,
		accountID,
		strings.TrimSpace(ldapUser.ProviderUserID),
		strings.ToLower(strings.TrimSpace(ldapUser.Email)),
		string(attributes),
	); err != nil {
		return fmt.Errorf("update ldap oauth account: %w", err)
	}
	return nil
}

func ldapAutoProvisionEnabled() bool {
	return strings.TrimSpace(os.Getenv("LDAP_AUTO_PROVISION")) != "false"
}

func nullableString(value string) any {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil
	}
	return value
}
