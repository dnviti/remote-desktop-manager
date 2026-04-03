package vaultapi

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestEnforceVaultMFARateLimitBlocksAfterFiveAttempts(t *testing.T) {
	t.Parallel()

	svc := newRateLimitedVaultService(t)
	ctx := context.Background()

	for i := 0; i < defaultVaultMFARateLimitAttempts; i++ {
		if err := svc.enforceVaultMFARateLimit(ctx, "user-1"); err != nil {
			t.Fatalf("attempt %d error = %v", i+1, err)
		}
	}

	err := svc.enforceVaultMFARateLimit(ctx, "user-1")
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %v", err)
	}
	if reqErr.status != 429 {
		t.Fatalf("status = %d, want 429", reqErr.status)
	}
}

func TestEnforceVaultRecoveryRateLimitUsesConfiguredMaxAttempts(t *testing.T) {
	t.Setenv("VAULT_RATE_LIMIT_MAX_ATTEMPTS", "2")

	svc := newRateLimitedVaultService(t)
	ctx := context.Background()

	for i := 0; i < 2; i++ {
		if err := svc.enforceVaultRecoveryRateLimit(ctx, "user-1"); err != nil {
			t.Fatalf("attempt %d error = %v", i+1, err)
		}
	}

	err := svc.enforceVaultRecoveryRateLimit(ctx, "user-1")
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %v", err)
	}
	if reqErr.status != 429 {
		t.Fatalf("status = %d, want 429", reqErr.status)
	}
}

func newRateLimitedVaultService(t *testing.T) Service {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	return Service{Redis: client}
}
