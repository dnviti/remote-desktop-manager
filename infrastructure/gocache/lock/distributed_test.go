package lock

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestAcquireRelease(t *testing.T) {
	m := New()
	defer m.Close()

	acquired, token := m.AcquireLock("mylock", time.Second, "holder-1")
	if !acquired {
		t.Fatal("expected lock to be acquired")
	}
	if token == 0 {
		t.Fatal("expected non-zero fencing token")
	}

	released := m.ReleaseLock("mylock", "holder-1")
	if !released {
		t.Fatal("expected lock to be released")
	}
}

func TestContention(t *testing.T) {
	m := New()
	defer m.Close()

	acquired1, _ := m.AcquireLock("shared", time.Second, "a")
	if !acquired1 {
		t.Fatal("expected first acquire to succeed")
	}

	acquired2, _ := m.AcquireLock("shared", time.Second, "b")
	if acquired2 {
		t.Fatal("expected second acquire to fail while lock is held")
	}

	// Wrong holder cannot release.
	if m.ReleaseLock("shared", "b") {
		t.Fatal("expected release by wrong holder to fail")
	}

	// Correct holder releases.
	m.ReleaseLock("shared", "a")

	// Now b can acquire.
	acquired3, _ := m.AcquireLock("shared", time.Second, "b")
	if !acquired3 {
		t.Fatal("expected acquire after release to succeed")
	}
	m.ReleaseLock("shared", "b")
}

func TestTTLExpiry(t *testing.T) {
	m := New()
	defer m.Close()

	now := time.Now()
	m.clock = func() time.Time { return now }

	m.AcquireLock("expiring", 100*time.Millisecond, "holder")

	// Advance past TTL.
	m.clock = func() time.Time { return now.Add(200 * time.Millisecond) }

	// Another holder should be able to acquire.
	acquired, _ := m.AcquireLock("expiring", time.Second, "other")
	if !acquired {
		t.Fatal("expected acquire after TTL expiry to succeed")
	}
	m.ReleaseLock("expiring", "other")
}

func TestFencingTokensMonotonic(t *testing.T) {
	m := New()
	defer m.Close()

	_, token1 := m.AcquireLock("lock-a", time.Second, "h1")
	m.ReleaseLock("lock-a", "h1")

	_, token2 := m.AcquireLock("lock-a", time.Second, "h2")
	m.ReleaseLock("lock-a", "h2")

	_, token3 := m.AcquireLock("lock-b", time.Second, "h3")
	m.ReleaseLock("lock-b", "h3")

	if token2 <= token1 || token3 <= token2 {
		t.Fatalf("tokens should be monotonically increasing: %d, %d, %d", token1, token2, token3)
	}
}

func TestRenewLock(t *testing.T) {
	m := New()
	defer m.Close()

	now := time.Now()
	m.clock = func() time.Time { return now }

	m.AcquireLock("renew-me", 100*time.Millisecond, "holder")

	// Advance time but still within TTL.
	m.clock = func() time.Time { return now.Add(50 * time.Millisecond) }
	if !m.RenewLock("renew-me", 200*time.Millisecond, "holder") {
		t.Fatal("expected renew to succeed")
	}

	// Wrong holder cannot renew.
	if m.RenewLock("renew-me", 200*time.Millisecond, "wrong") {
		t.Fatal("expected renew by wrong holder to fail")
	}

	// After original TTL, lock should still be held thanks to renewal.
	m.clock = func() time.Time { return now.Add(150 * time.Millisecond) }
	acquired, _ := m.AcquireLock("renew-me", time.Second, "other")
	if acquired {
		t.Fatal("expected acquire to fail because lock was renewed")
	}

	m.ReleaseLock("renew-me", "holder")
}

func TestRunIfLeader(t *testing.T) {
	m := New()
	defer m.Close()

	var ran atomic.Bool
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	ok := m.RunIfLeader(ctx, "leader-lock", time.Second, "me", 200*time.Millisecond, func(ctx context.Context) {
		ran.Store(true)
	})
	if !ok {
		t.Fatal("expected RunIfLeader to acquire and start")
	}

	// Wait for fn to complete.
	time.Sleep(100 * time.Millisecond)
	if !ran.Load() {
		t.Fatal("expected fn to have run")
	}
}

func TestRunIfLeaderContention(t *testing.T) {
	m := New()
	defer m.Close()

	ctx := context.Background()

	m.AcquireLock("contested", time.Second, "first")
	ok := m.RunIfLeader(ctx, "contested", time.Second, "second", 200*time.Millisecond, func(ctx context.Context) {
		t.Fatal("should not run")
	})
	if ok {
		t.Fatal("expected RunIfLeader to fail when lock is held")
	}
	m.ReleaseLock("contested", "first")
}
