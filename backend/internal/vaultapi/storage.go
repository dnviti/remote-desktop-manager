package vaultapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func (s Service) loadUserSettings(ctx context.Context, userID string) (userVaultSettings, error) {
	if s.DB == nil {
		return userVaultSettings{}, fmt.Errorf("database is unavailable")
	}

	var result userVaultSettings
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE("vaultNeedsRecovery", false),
		        COALESCE("webauthnEnabled", false),
		        COALESCE("totpEnabled", false),
		        COALESCE("smsMfaEnabled", false),
		        "vaultAutoLockMinutes"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&result.VaultNeedsRecovery,
		&result.WebAuthnEnabled,
		&result.TOTPEnabled,
		&result.SMSMFAEnabled,
		&result.AutoLockMinutes,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return userVaultSettings{}, &requestError{status: 404, message: "User not found"}
		}
		return userVaultSettings{}, fmt.Errorf("load user vault settings: %w", err)
	}
	return result, nil
}

func (s Service) loadTenantPolicy(ctx context.Context, userID, tenantID string) (tenantVaultPolicy, error) {
	if s.DB == nil {
		return tenantVaultPolicy{}, fmt.Errorf("database is unavailable")
	}

	if strings.TrimSpace(tenantID) != "" {
		policy, found, err := s.queryTenantPolicy(ctx, userID, tenantID)
		if err != nil {
			return tenantVaultPolicy{}, err
		}
		if found {
			return policy, nil
		}
	}

	policy, _, err := s.queryAnyTenantPolicy(ctx, userID)
	if err != nil {
		return tenantVaultPolicy{}, err
	}
	return policy, nil
}

func (s Service) queryTenantPolicy(ctx context.Context, userID, tenantID string) (tenantVaultPolicy, bool, error) {
	var policy tenantVaultPolicy
	err := s.DB.QueryRow(
		ctx,
		`SELECT t."vaultAutoLockMaxMinutes", t."vaultDefaultTtlMinutes"
		   FROM "TenantMember" tm
		   JOIN "Tenant" t ON t.id = tm."tenantId"
		  WHERE tm."userId" = $1
		    AND tm."tenantId" = $2
		    AND tm."isActive" = true
		    AND tm.status::text = 'ACCEPTED'
		    AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
		  LIMIT 1`,
		userID,
		tenantID,
	).Scan(&policy.MaxMinutes, &policy.DefaultMinutes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantVaultPolicy{}, false, nil
		}
		return tenantVaultPolicy{}, false, fmt.Errorf("load tenant vault policy: %w", err)
	}
	return policy, true, nil
}

func (s Service) queryAnyTenantPolicy(ctx context.Context, userID string) (tenantVaultPolicy, bool, error) {
	var policy tenantVaultPolicy
	err := s.DB.QueryRow(
		ctx,
		`SELECT t."vaultAutoLockMaxMinutes", t."vaultDefaultTtlMinutes"
		   FROM "TenantMember" tm
		   JOIN "Tenant" t ON t.id = tm."tenantId"
		  WHERE tm."userId" = $1
		    AND tm."isActive" = true
		    AND tm.status::text = 'ACCEPTED'
		    AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
		  ORDER BY tm."joinedAt" ASC, tm."tenantId" ASC
		  LIMIT 1`,
		userID,
	).Scan(&policy.MaxMinutes, &policy.DefaultMinutes)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantVaultPolicy{}, false, nil
		}
		return tenantVaultPolicy{}, false, fmt.Errorf("load tenant vault policy: %w", err)
	}
	return policy, true, nil
}

func resolveEffectiveMinutes(userPref, tenantDefault, tenantMax *int) int {
	effective := envDefaultVaultMinutes()
	if tenantDefault != nil {
		effective = *tenantDefault
	}
	if userPref != nil {
		effective = *userPref
	}

	if tenantMax != nil && *tenantMax > 0 {
		if effective == 0 {
			effective = *tenantMax
		} else if effective > *tenantMax {
			effective = *tenantMax
		}
	}

	return effective
}

func envDefaultVaultMinutes() int {
	raw := strings.TrimSpace(os.Getenv("VAULT_TTL_MINUTES"))
	if raw == "" {
		return 30
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value < 0 {
		return 30
	}
	return value
}

func (s Service) hasRedisKey(ctx context.Context, key string) bool {
	if s.Redis == nil {
		return false
	}
	count, err := s.Redis.Exists(ctx, key).Result()
	if err != nil {
		return false
	}
	return count > 0
}

func (s Service) deletePattern(ctx context.Context, pattern string) error {
	if s.Redis == nil {
		return nil
	}
	var cursor uint64
	for {
		keys, nextCursor, err := s.Redis.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("scan %s: %w", pattern, err)
		}
		if len(keys) > 0 {
			if err := s.Redis.Del(ctx, keys...).Err(); err != nil && !errors.Is(err, redis.Nil) {
				return fmt.Errorf("delete %s keys: %w", pattern, err)
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			return nil
		}
	}
}

func (s Service) insertAuditLog(ctx context.Context, userID, action string, details map[string]any, ipAddress string) error {
	if s.DB == nil {
		return nil
	}
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "ipAddress", "createdAt"
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, NULLIF($5, ''), $6
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		ipAddress,
		time.Now(),
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (s Service) insertAuditLogTx(ctx context.Context, tx pgx.Tx, userID, action string, details map[string]any, ipAddress string) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "ipAddress", "createdAt"
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, NULLIF($5, ''), $6
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		ipAddress,
		time.Now(),
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func (s Service) insertConnectionAuditLog(ctx context.Context, userID, action, connectionID, ipAddress string) error {
	if s.DB == nil {
		return nil
	}
	if _, err := s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, "targetType", "targetId", details, "ipAddress", "createdAt"
		) VALUES (
			$1, $2, $3::"AuditAction", 'Connection', $4, '{}'::jsonb, NULLIF($5, ''), $6
		)`,
		uuid.NewString(),
		userID,
		action,
		connectionID,
		ipAddress,
		time.Now(),
	); err != nil {
		return fmt.Errorf("insert connection audit log: %w", err)
	}
	return nil
}

func (s Service) loadVaultCredentials(ctx context.Context, userID string) (vaultCredentials, error) {
	if s.DB == nil {
		return vaultCredentials{}, fmt.Errorf("database is unavailable")
	}

	var creds vaultCredentials
	if err := s.DB.QueryRow(
		ctx,
		`SELECT "passwordHash",
		        "vaultSalt",
		        "encryptedVaultKey",
		        "vaultKeyIV",
		        "vaultKeyTag",
		        COALESCE("vaultNeedsRecovery", false),
		        "encryptedVaultRecoveryKey",
		        "vaultRecoveryKeyIV",
		        "vaultRecoveryKeyTag",
		        "vaultRecoveryKeySalt"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&creds.PasswordHash,
		&creds.VaultSalt,
		&creds.EncryptedVaultKey,
		&creds.VaultKeyIV,
		&creds.VaultKeyTag,
		&creds.VaultNeedsRecovery,
		&creds.EncryptedVaultRecoveryKey,
		&creds.VaultRecoveryKeyIV,
		&creds.VaultRecoveryKeyTag,
		&creds.VaultRecoveryKeySalt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return vaultCredentials{}, &requestError{status: 404, message: "User not found"}
		}
		return vaultCredentials{}, fmt.Errorf("load vault credentials: %w", err)
	}
	return creds, nil
}

func (s Service) storeVaultSession(ctx context.Context, userID string, masterKey []byte) error {
	if s.Redis == nil || len(s.ServerKey) != 32 {
		return nil
	}
	encrypted, err := encryptValue(s.ServerKey, hex.EncodeToString(masterKey))
	if err != nil {
		return fmt.Errorf("encrypt vault session: %w", err)
	}
	raw, err := json.Marshal(encrypted)
	if err != nil {
		return fmt.Errorf("marshal vault session: %w", err)
	}
	ttl := s.VaultTTL
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if err := s.Redis.Set(ctx, "vault:user:"+userID, raw, ttl).Err(); err != nil {
		return fmt.Errorf("store vault session: %w", err)
	}
	if err := s.Redis.Set(ctx, "vault:recovery:"+userID, raw, 7*24*time.Hour).Err(); err != nil {
		return fmt.Errorf("store vault recovery: %w", err)
	}
	return nil
}

func (s Service) clearVaultSessions(ctx context.Context, userID string) error {
	if s.Redis == nil {
		return nil
	}
	keysToDelete := []string{
		"vault:user:" + userID,
		"vault:user-teams:" + userID,
		"vault:user-tenants:" + userID,
	}
	if err := s.Redis.Del(ctx, keysToDelete...).Err(); err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("delete vault session keys: %w", err)
	}
	if err := s.deletePattern(ctx, "vault:team:*:"+userID); err != nil {
		return err
	}
	if err := s.deletePattern(ctx, "vault:tenant:*:"+userID); err != nil {
		return err
	}
	return nil
}

func (s Service) clearVaultRecovery(ctx context.Context, userID string) error {
	if s.Redis == nil {
		return nil
	}
	if err := s.Redis.Del(ctx, "vault:recovery:"+userID).Err(); err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("delete vault recovery key: %w", err)
	}
	return nil
}

func (s Service) publishVaultStatus(ctx context.Context, userID string, unlocked bool) error {
	if s.Redis == nil {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"userId": userID, "unlocked": unlocked})
	if err := s.Redis.Publish(ctx, "vault:status", string(payload)).Err(); err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("publish vault status: %w", err)
	}
	return nil
}
