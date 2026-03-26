// Package kv implements a sharded in-memory key-value store with per-key TTL,
// lazy expiry, background sweeping, and LRU eviction under memory pressure.
package kv

import (
	"container/list"
	"encoding/binary"
	"hash/fnv"
	"sync"
	"sync/atomic"
	"time"
)

const (
	numShards       = 256
	sweepInterval   = time.Second
	sweepSampleSize = 20
)

// entry holds a value and optional expiry metadata.
type entry struct {
	value     []byte
	expiresAt int64  // unix-nano; 0 = no expiry
	size      int    // approximate in-memory size
	lruElem   *list.Element
	timestamp uint64 // logical timestamp for LWW conflict resolution
}

// shard is a single partition of the key-space.
type shard struct {
	mu      sync.RWMutex
	items   map[string]*entry
	lruList *list.List // front = most recently used
}

// Store is a sharded in-memory KV store.
type Store struct {
	shards    [numShards]shard
	maxMemory int64 // bytes; 0 = unlimited
	usedMem   atomic.Int64
	stopCh    chan struct{}
	clock     func() time.Time // injectable for tests
}

// New creates a new Store. maxMemory of 0 means unlimited.
func New(maxMemory int64) *Store {
	s := &Store{
		maxMemory: maxMemory,
		stopCh:    make(chan struct{}),
		clock:     time.Now,
	}
	for i := range s.shards {
		s.shards[i].items = make(map[string]*entry)
		s.shards[i].lruList = list.New()
	}
	go s.sweepLoop()
	return s
}

// Close stops the background sweeper.
func (s *Store) Close() {
	close(s.stopCh)
}

// shardFor returns the shard index for a given key.
func shardFor(key string) uint32 {
	h := fnv.New32a()
	h.Write([]byte(key))
	return h.Sum32() % numShards
}

func entrySize(key string, value []byte) int {
	return len(key) + len(value) + 64 // 64 bytes overhead estimate
}

// Get retrieves a value. Returns (nil, false) if not found or expired.
func (s *Store) Get(key string) ([]byte, bool) {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if !ok {
		return nil, false
	}
	if e.expiresAt != 0 && s.clock().UnixNano() >= e.expiresAt {
		s.deleteEntryLocked(sh, key, e)
		return nil, false
	}
	sh.lruList.MoveToFront(e.lruElem)
	dst := make([]byte, len(e.value))
	copy(dst, e.value)
	return dst, true
}

// Set stores a value with an optional TTL (0 = no expiry).
func (s *Store) Set(key string, value []byte, ttl time.Duration) {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	var expiresAt int64
	if ttl > 0 {
		expiresAt = s.clock().Add(ttl).UnixNano()
	}

	sz := entrySize(key, value)

	if old, ok := sh.items[key]; ok {
		s.usedMem.Add(int64(-old.size))
		old.value = value
		old.expiresAt = expiresAt
		old.size = sz
		sh.lruList.MoveToFront(old.lruElem)
		s.usedMem.Add(int64(sz))
	} else {
		e := &entry{
			value:     value,
			expiresAt: expiresAt,
			size:      sz,
		}
		e.lruElem = sh.lruList.PushFront(key)
		sh.items[key] = e
		s.usedMem.Add(int64(sz))
	}

	// Evict if over memory limit (release lock briefly for cross-shard eviction).
	if s.maxMemory > 0 && s.usedMem.Load() > s.maxMemory {
		sh.mu.Unlock()
		s.evict()
		sh.mu.Lock()
	}
}

// Delete removes a key. Returns true if the key existed.
func (s *Store) Delete(key string) bool {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if !ok {
		return false
	}
	s.deleteEntryLocked(sh, key, e)
	return true
}

// Exists checks if a key exists and is not expired.
func (s *Store) Exists(key string) bool {
	sh := &s.shards[shardFor(key)]
	sh.mu.RLock()
	defer sh.mu.RUnlock()

	e, ok := sh.items[key]
	if !ok {
		return false
	}
	if e.expiresAt != 0 && s.clock().UnixNano() >= e.expiresAt {
		return false
	}
	return true
}

// Expire updates the TTL on an existing key. Returns false if key not found.
func (s *Store) Expire(key string, ttl time.Duration) bool {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if !ok {
		return false
	}
	if e.expiresAt != 0 && s.clock().UnixNano() >= e.expiresAt {
		s.deleteEntryLocked(sh, key, e)
		return false
	}
	if ttl > 0 {
		e.expiresAt = s.clock().Add(ttl).UnixNano()
	} else {
		e.expiresAt = 0
	}
	return true
}

// Incr atomically increments a key's value interpreted as a little-endian int64.
// If the key does not exist, it is initialized to 0 before incrementing.
func (s *Store) Incr(key string, delta int64) int64 {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if ok && e.expiresAt != 0 && s.clock().UnixNano() >= e.expiresAt {
		s.deleteEntryLocked(sh, key, e)
		ok = false
	}

	var current int64
	if ok {
		if len(e.value) == 8 {
			current = int64(binary.LittleEndian.Uint64(e.value))
		} else {
			// Non-8-byte value: reallocate to proper size and fix memory accounting.
			oldSize := e.size
			e.value = make([]byte, 8)
			newSize := entrySize(key, e.value)
			if newSize != oldSize {
				e.size = newSize
				s.usedMem.Add(int64(newSize - oldSize))
			}
		}
		current += delta
		binary.LittleEndian.PutUint64(e.value, uint64(current))
		sh.lruList.MoveToFront(e.lruElem)
		return current
	}

	current = delta
	val := make([]byte, 8)
	binary.LittleEndian.PutUint64(val, uint64(current))
	sz := entrySize(key, val)
	ne := &entry{
		value: val,
		size:  sz,
	}
	ne.lruElem = sh.lruList.PushFront(key)
	sh.items[key] = ne
	s.usedMem.Add(int64(sz))
	return current
}

// Decr atomically decrements a key's value.
func (s *Store) Decr(key string, delta int64) int64 {
	return s.Incr(key, -delta)
}

// GetDel atomically gets and deletes a key.
func (s *Store) GetDel(key string) ([]byte, bool) {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if !ok {
		return nil, false
	}
	if e.expiresAt != 0 && s.clock().UnixNano() >= e.expiresAt {
		s.deleteEntryLocked(sh, key, e)
		return nil, false
	}
	val := make([]byte, len(e.value))
	copy(val, e.value)
	s.deleteEntryLocked(sh, key, e)
	return val, true
}

// deleteEntryLocked removes an entry. Caller must hold sh.mu write lock.
func (s *Store) deleteEntryLocked(sh *shard, key string, e *entry) {
	sh.lruList.Remove(e.lruElem)
	delete(sh.items, key)
	s.usedMem.Add(int64(-e.size))
}

// evict removes LRU entries across shards until under memory limit.
func (s *Store) evict() {
	for s.maxMemory > 0 && s.usedMem.Load() > s.maxMemory {
		evicted := false
		for i := range s.shards {
			sh := &s.shards[i]
			sh.mu.Lock()
			back := sh.lruList.Back()
			if back != nil {
				key := back.Value.(string)
				if e, ok := sh.items[key]; ok {
					s.deleteEntryLocked(sh, key, e)
					evicted = true
				}
			}
			sh.mu.Unlock()
			if s.usedMem.Load() <= s.maxMemory {
				return
			}
		}
		if !evicted {
			return
		}
	}
}

// sweepLoop runs periodically to clean up expired keys.
func (s *Store) sweepLoop() {
	ticker := time.NewTicker(sweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-s.stopCh:
			return
		case <-ticker.C:
			s.sweep()
		}
	}
}

// sweep checks a sample of keys per shard and removes expired ones.
func (s *Store) sweep() {
	now := s.clock().UnixNano()
	for i := range s.shards {
		sh := &s.shards[i]
		sh.mu.Lock()
		count := 0
		for key, e := range sh.items {
			if count >= sweepSampleSize {
				break
			}
			if e.expiresAt != 0 && now >= e.expiresAt {
				s.deleteEntryLocked(sh, key, e)
			}
			count++
		}
		sh.mu.Unlock()
	}
}

// SetIfNewer stores a value only if the given timestamp is newer than the current
// entry's timestamp (last-writer-wins). Returns true if the value was applied.
func (s *Store) SetIfNewer(key string, value []byte, ttl time.Duration, timestamp uint64) bool {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	if old, ok := sh.items[key]; ok {
		if old.timestamp > timestamp {
			return false // stale update
		}
	}

	var expiresAt int64
	if ttl > 0 {
		expiresAt = s.clock().Add(ttl).UnixNano()
	}

	sz := entrySize(key, value)

	if old, ok := sh.items[key]; ok {
		s.usedMem.Add(int64(-old.size))
		old.value = value
		old.expiresAt = expiresAt
		old.size = sz
		old.timestamp = timestamp
		sh.lruList.MoveToFront(old.lruElem)
		s.usedMem.Add(int64(sz))
	} else {
		e := &entry{
			value:     value,
			expiresAt: expiresAt,
			size:      sz,
			timestamp: timestamp,
		}
		e.lruElem = sh.lruList.PushFront(key)
		sh.items[key] = e
		s.usedMem.Add(int64(sz))
	}
	return true
}

// DeleteIfNewer deletes a key only if the given timestamp is newer than the
// current entry's timestamp (last-writer-wins). Returns true if deleted.
func (s *Store) DeleteIfNewer(key string, timestamp uint64) bool {
	sh := &s.shards[shardFor(key)]
	sh.mu.Lock()
	defer sh.mu.Unlock()

	e, ok := sh.items[key]
	if !ok {
		return false
	}
	if e.timestamp > timestamp {
		return false // stale delete
	}
	s.deleteEntryLocked(sh, key, e)
	return true
}

// UsedMemory returns the current memory usage estimate in bytes.
func (s *Store) UsedMemory() int64 {
	return s.usedMem.Load()
}
