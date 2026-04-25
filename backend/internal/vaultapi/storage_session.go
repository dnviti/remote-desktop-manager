package vaultapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

func (s Service) effectiveVaultTTL() time.Duration {
	if s.VaultTTL > 0 {
		return s.VaultTTL
	}
	return 30 * time.Minute
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
	ttl := s.effectiveVaultTTL()
	if err := s.Redis.Set(ctx, "vault:user:"+userID, raw, ttl).Err(); err != nil {
		return fmt.Errorf("store vault session: %w", err)
	}
	if err := s.Redis.Set(ctx, "vault:recovery:"+userID, raw, 7*24*time.Hour).Err(); err != nil {
		return fmt.Errorf("store vault recovery: %w", err)
	}
	if s.TenantVaultService != nil {
		if err := s.TenantVaultService.ProcessPendingDistributionsForUser(ctx, userID); err != nil {
			return fmt.Errorf("process pending tenant vault distributions: %w", err)
		}
	}
	return nil
}

func (s Service) TouchVaultSession(ctx context.Context, userID string) (bool, error) {
	if s.Redis == nil || userID == "" {
		return false, nil
	}

	ttl := s.effectiveVaultTTL()
	touched, err := s.Redis.Expire(ctx, "vault:user:"+userID, ttl).Result()
	if err != nil {
		return false, fmt.Errorf("touch vault session: %w", err)
	}
	if !touched {
		if err := s.publishVaultStatus(ctx, userID, false); err != nil {
			return false, err
		}
		return false, nil
	}
	if err := s.touchTTLPattern(ctx, "vault:team:*:"+userID, ttl); err != nil {
		return false, err
	}
	if err := s.touchTTLPattern(ctx, "vault:tenant:*:"+userID, ttl); err != nil {
		return false, err
	}
	return true, nil
}

func (s Service) touchTTLPattern(ctx context.Context, pattern string, ttl time.Duration) error {
	if s.Redis == nil {
		return nil
	}
	var cursor uint64
	for {
		keys, nextCursor, err := s.Redis.Scan(ctx, cursor, pattern, 100).Result()
		if err != nil {
			return fmt.Errorf("scan %s: %w", pattern, err)
		}
		for _, key := range keys {
			if err := s.Redis.Expire(ctx, key, ttl).Err(); err != nil && !errors.Is(err, redis.Nil) {
				return fmt.Errorf("touch %s: %w", key, err)
			}
		}
		cursor = nextCursor
		if cursor == 0 {
			return nil
		}
	}
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
	if err := s.Redis.Publish(ctx, vaultStatusStreamChannel, string(payload)).Err(); err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("publish vault status: %w", err)
	}
	return nil
}
