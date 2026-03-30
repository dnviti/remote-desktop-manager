package tenantvaultapi

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/redis/go-redis/v9"
)

func (s Service) loadUserMasterKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil {
		return nil, nil
	}
	raw, err := s.Redis.Get(ctx, "vault:user:"+userID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault session: %w", err)
	}
	var field encryptedField
	if _, err := rediscompat.DecodeJSONPayload(raw, &field); err != nil {
		return nil, fmt.Errorf("decode vault session: %w", err)
	}
	plaintext, err := decryptValue(s.ServerKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault session: %w", err)
	}
	key, err := hex.DecodeString(plaintext)
	if err != nil {
		return nil, fmt.Errorf("decode vault key: %w", err)
	}
	return key, nil
}

func (s Service) loadCachedTenantKey(ctx context.Context, tenantID, userID string) ([]byte, error) {
	if s.Redis == nil {
		return nil, nil
	}
	raw, err := s.Redis.Get(ctx, "vault:tenant:"+tenantID+":"+userID).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load cached tenant vault session: %w", err)
	}
	var field encryptedField
	normalized, err := rediscompat.DecodeJSONPayload(raw, &field)
	if err != nil {
		return nil, fmt.Errorf("decode cached tenant vault session: %w", err)
	}
	plaintext, err := decryptValue(s.ServerKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt cached tenant vault session: %w", err)
	}
	key, err := hex.DecodeString(plaintext)
	if err != nil {
		return nil, fmt.Errorf("decode cached tenant vault key: %w", err)
	}
	ttl := s.effectiveVaultTTL()
	if ttl > 0 {
		_ = s.Redis.Set(ctx, "vault:tenant:"+tenantID+":"+userID, normalized, ttl).Err()
	}
	return key, nil
}

func (s Service) storeTenantVaultSession(ctx context.Context, tenantID, userID string, tenantKey []byte) error {
	if s.Redis == nil {
		return nil
	}
	field, err := encryptValue(s.ServerKey, hex.EncodeToString(tenantKey))
	if err != nil {
		return fmt.Errorf("encrypt tenant vault session: %w", err)
	}
	raw, err := json.Marshal(field)
	if err != nil {
		return fmt.Errorf("marshal tenant vault session: %w", err)
	}
	ttl := s.effectiveVaultTTL()
	if err := s.Redis.Set(ctx, "vault:tenant:"+tenantID+":"+userID, raw, ttl).Err(); err != nil {
		return fmt.Errorf("store tenant vault session: %w", err)
	}
	if err := s.addToIndex(ctx, "vault:tenant-idx:"+tenantID, userID); err != nil {
		return err
	}
	if err := s.addToIndex(ctx, "vault:user-tenants:"+userID, tenantID); err != nil {
		return err
	}
	return nil
}

func (s Service) addToIndex(ctx context.Context, key, value string) error {
	if s.Redis == nil {
		return nil
	}
	raw, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil && !errors.Is(err, redis.Nil) {
		return fmt.Errorf("load index %s: %w", key, err)
	}
	var values []string
	if len(raw) > 0 {
		normalized, err := rediscompat.NormalizeJSONPayload(raw)
		if err != nil {
			return fmt.Errorf("decode index %s: %w", key, err)
		}
		if err := json.Unmarshal(normalized, &values); err != nil {
			return fmt.Errorf("decode index %s: %w", key, err)
		}
	}
	for _, existing := range values {
		if existing == value {
			marshaled, _ := json.Marshal(values)
			return s.Redis.Set(ctx, key, marshaled, 0).Err()
		}
	}
	values = append(values, value)
	marshaled, err := json.Marshal(values)
	if err != nil {
		return fmt.Errorf("encode index %s: %w", key, err)
	}
	if err := s.Redis.Set(ctx, key, marshaled, 0).Err(); err != nil {
		return fmt.Errorf("store index %s: %w", key, err)
	}
	return nil
}

func (s Service) effectiveVaultTTL() time.Duration {
	if s.VaultTTL > 0 {
		return s.VaultTTL
	}
	return 30 * time.Minute
}
