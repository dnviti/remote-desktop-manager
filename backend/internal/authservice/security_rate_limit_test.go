package authservice

import (
	"context"
	"errors"
	"testing"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"
)

func TestEnforceLoginMFARateLimitBlocksAfterFiveAttempts(t *testing.T) {
	t.Parallel()

	svc := newRateLimitedAuthService(t)
	ctx := context.Background()

	for i := 0; i < loginMFARateLimitMaxAttempts; i++ {
		if err := svc.enforceLoginMFARateLimit(ctx, "user-1", "203.0.113.10"); err != nil {
			t.Fatalf("attempt %d error = %v", i+1, err)
		}
	}

	err := svc.enforceLoginMFARateLimit(ctx, "user-1", "203.0.113.10")
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("expected requestError, got %v", err)
	}
	if reqErr.status != 429 {
		t.Fatalf("status = %d, want 429", reqErr.status)
	}
}

func newRateLimitedAuthService(t *testing.T) Service {
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
