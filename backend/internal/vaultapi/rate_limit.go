package vaultapi

import (
	"context"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"
)

const (
	defaultVaultRateLimitWindow      = time.Minute
	defaultVaultRateLimitMaxAttempts = 5
	defaultVaultMFARateLimitAttempts = 5
)

func (s Service) enforceSlidingWindowLimit(ctx context.Context, key string, window time.Duration, maxAttempts int, message string) error {
	if s.Redis == nil || strings.TrimSpace(key) == "" || window <= 0 || maxAttempts <= 0 {
		return nil
	}

	now := time.Now()
	windowMs := window.Milliseconds()
	windowStart := now.UnixMilli() / windowMs * windowMs
	windowEnd := windowStart + windowMs
	redisKey := fmt.Sprintf("%s:%d", key, windowStart)

	count, err := s.Redis.Incr(ctx, redisKey).Result()
	if err != nil {
		return fmt.Errorf("increment rate limit: %w", err)
	}

	ttl := time.Duration(windowEnd-now.UnixMilli()+1000) * time.Millisecond
	if ttl > 0 {
		_ = s.Redis.PExpire(ctx, redisKey, ttl).Err()
	}

	if count > int64(maxAttempts) {
		return &requestError{status: http.StatusTooManyRequests, message: message}
	}
	return nil
}

func (s Service) enforceVaultUnlockRateLimit(ctx context.Context, userID string) error {
	return s.enforceSlidingWindowLimit(
		ctx,
		"rl:vault-unlock:"+strings.TrimSpace(userID),
		s.vaultRateLimitWindow(),
		s.vaultRateLimitMaxAttempts(),
		"Too many vault unlock attempts. Please try again later.",
	)
}

func (s Service) enforceVaultRecoveryRateLimit(ctx context.Context, userID string) error {
	return s.enforceSlidingWindowLimit(
		ctx,
		"rl:vault-recovery:"+strings.TrimSpace(userID),
		s.vaultRateLimitWindow(),
		s.vaultRateLimitMaxAttempts(),
		"Too many vault unlock attempts. Please try again later.",
	)
}

func (s Service) enforceVaultMFARateLimit(ctx context.Context, userID string) error {
	return s.enforceSlidingWindowLimit(
		ctx,
		"rl:vault-mfa:"+strings.TrimSpace(userID),
		s.vaultRateLimitWindow(),
		s.vaultMFARateLimitMaxAttempts(),
		"Too many vault unlock attempts. Please try again later.",
	)
}

func (s Service) vaultRateLimitWindow() time.Duration {
	if value := strings.TrimSpace(os.Getenv("VAULT_RATE_LIMIT_WINDOW_MS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	return defaultVaultRateLimitWindow
}

func (s Service) vaultRateLimitMaxAttempts() int {
	if value := strings.TrimSpace(os.Getenv("VAULT_RATE_LIMIT_MAX_ATTEMPTS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultVaultRateLimitMaxAttempts
}

func (s Service) vaultMFARateLimitMaxAttempts() int {
	if value := strings.TrimSpace(os.Getenv("VAULT_MFA_RATE_LIMIT_MAX_ATTEMPTS")); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil && parsed > 0 {
			return parsed
		}
	}
	return defaultVaultMFARateLimitAttempts
}
