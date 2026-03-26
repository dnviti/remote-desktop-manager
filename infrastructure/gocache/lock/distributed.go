// Package lock implements distributed locks with fencing tokens and TTL-based auto-expiry.
package lock

import (
	"context"
	"sync"
	"time"
)

// lockEntry represents a held lock.
type lockEntry struct {
	holderID     string
	fencingToken uint64
	expiresAt    time.Time
}

// Manager manages distributed locks.
type Manager struct {
	mu           sync.Mutex
	locks        map[string]*lockEntry
	tokenCounter uint64
	clock        func() time.Time
	stopCh       chan struct{}
}

// New creates a new lock Manager.
func New() *Manager {
	m := &Manager{
		locks:  make(map[string]*lockEntry),
		clock:  time.Now,
		stopCh: make(chan struct{}),
	}
	go m.expiryLoop()
	return m
}

// Close stops the background expiry loop.
func (m *Manager) Close() {
	close(m.stopCh)
}

// AcquireLock attempts to acquire a named lock. Returns (acquired, fencingToken).
// The fencing token is monotonically increasing per lock name.
func (m *Manager) AcquireLock(name string, ttl time.Duration, holderID string) (bool, uint64) {
	m.mu.Lock()
	defer m.mu.Unlock()

	now := m.clock()

	if existing, ok := m.locks[name]; ok {
		if now.Before(existing.expiresAt) {
			// Lock is still held by someone else.
			return false, 0
		}
		// Expired, clean up.
		delete(m.locks, name)
	}

	m.tokenCounter++
	token := m.tokenCounter
	m.locks[name] = &lockEntry{
		holderID:     holderID,
		fencingToken: token,
		expiresAt:    now.Add(ttl),
	}
	return true, token
}

// ReleaseLock releases a lock if held by the given holder. Returns true if released.
func (m *Manager) ReleaseLock(name, holderID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.locks[name]
	if !ok {
		return false
	}
	if entry.holderID != holderID {
		return false
	}
	delete(m.locks, name)
	return true
}

// RenewLock extends the TTL of a lock held by the given holder.
func (m *Manager) RenewLock(name string, ttl time.Duration, holderID string) bool {
	m.mu.Lock()
	defer m.mu.Unlock()

	entry, ok := m.locks[name]
	if !ok {
		return false
	}
	now := m.clock()
	if now.After(entry.expiresAt) || now.Equal(entry.expiresAt) {
		delete(m.locks, name)
		return false
	}
	if entry.holderID != holderID {
		return false
	}
	entry.expiresAt = now.Add(ttl)
	return true
}

// RunIfLeader acquires a lock, runs fn in a goroutine, renews the lock periodically,
// and releases it when ctx is cancelled or fn returns.
func (m *Manager) RunIfLeader(ctx context.Context, name string, ttl time.Duration, holderID string, renewInterval time.Duration, fn func(ctx context.Context)) bool {
	acquired, _ := m.AcquireLock(name, ttl, holderID)
	if !acquired {
		return false
	}

	ctx, cancel := context.WithCancel(ctx)
	go func() {
		defer cancel()
		defer m.ReleaseLock(name, holderID)

		done := make(chan struct{})
		go func() {
			defer close(done)
			fn(ctx)
		}()

		ticker := time.NewTicker(renewInterval)
		defer ticker.Stop()

		for {
			select {
			case <-done:
				return
			case <-ctx.Done():
				return
			case <-ticker.C:
				if !m.RenewLock(name, ttl, holderID) {
					cancel()
					return
				}
			}
		}
	}()
	return true
}

// expiryLoop periodically cleans up expired locks.
func (m *Manager) expiryLoop() {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-m.stopCh:
			return
		case <-ticker.C:
			m.mu.Lock()
			now := m.clock()
			for name, entry := range m.locks {
				if now.After(entry.expiresAt) || now.Equal(entry.expiresAt) {
					delete(m.locks, name)
				}
			}
			m.mu.Unlock()
		}
	}
}
