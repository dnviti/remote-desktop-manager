package kv

import (
	"fmt"
	"sync"
	"testing"
	"time"
)

func TestSetGetRoundTrip(t *testing.T) {
	s := New(0)
	defer s.Close()

	s.Set("hello", []byte("world"), 0)
	val, ok := s.Get("hello")
	if !ok {
		t.Fatal("expected key to exist")
	}
	if string(val) != "world" {
		t.Fatalf("expected 'world', got %q", string(val))
	}
}

func TestGetMissing(t *testing.T) {
	s := New(0)
	defer s.Close()

	_, ok := s.Get("missing")
	if ok {
		t.Fatal("expected key to not exist")
	}
}

func TestTTLExpiry(t *testing.T) {
	s := New(0)
	defer s.Close()

	now := time.Now()
	s.clock = func() time.Time { return now }

	s.Set("ephemeral", []byte("data"), 100*time.Millisecond)

	val, ok := s.Get("ephemeral")
	if !ok || string(val) != "data" {
		t.Fatal("expected key to exist before expiry")
	}

	// Advance clock past TTL.
	s.clock = func() time.Time { return now.Add(200 * time.Millisecond) }

	_, ok = s.Get("ephemeral")
	if ok {
		t.Fatal("expected key to be expired")
	}
}

func TestDelete(t *testing.T) {
	s := New(0)
	defer s.Close()

	s.Set("key", []byte("val"), 0)
	if !s.Delete("key") {
		t.Fatal("expected Delete to return true")
	}
	if s.Delete("key") {
		t.Fatal("expected Delete to return false for missing key")
	}
	_, ok := s.Get("key")
	if ok {
		t.Fatal("expected key to be gone after delete")
	}
}

func TestIncrDecr(t *testing.T) {
	s := New(0)
	defer s.Close()

	v := s.Incr("counter", 1)
	if v != 1 {
		t.Fatalf("expected 1, got %d", v)
	}
	v = s.Incr("counter", 5)
	if v != 6 {
		t.Fatalf("expected 6, got %d", v)
	}
	v = s.Decr("counter", 2)
	if v != 4 {
		t.Fatalf("expected 4, got %d", v)
	}
}

func TestGetDelAtomicity(t *testing.T) {
	s := New(0)
	defer s.Close()

	s.Set("once", []byte("value"), 0)

	val, ok := s.GetDel("once")
	if !ok || string(val) != "value" {
		t.Fatal("expected to get the value on first GetDel")
	}

	_, ok = s.GetDel("once")
	if ok {
		t.Fatal("expected second GetDel to return false")
	}

	_, ok = s.Get("once")
	if ok {
		t.Fatal("expected key to be gone after GetDel")
	}
}

func TestExists(t *testing.T) {
	s := New(0)
	defer s.Close()

	if s.Exists("nope") {
		t.Fatal("expected Exists to be false for missing key")
	}
	s.Set("present", []byte("yes"), 0)
	if !s.Exists("present") {
		t.Fatal("expected Exists to be true")
	}
}

func TestExpire(t *testing.T) {
	s := New(0)
	defer s.Close()

	now := time.Now()
	s.clock = func() time.Time { return now }

	s.Set("key", []byte("val"), 0)
	if !s.Expire("key", 50*time.Millisecond) {
		t.Fatal("expected Expire to succeed")
	}

	s.clock = func() time.Time { return now.Add(100 * time.Millisecond) }
	if s.Exists("key") {
		t.Fatal("expected key to be expired after Expire call")
	}
}

func TestConcurrentAccess(t *testing.T) {
	s := New(0)
	defer s.Close()

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func(n int) {
			defer wg.Done()
			key := fmt.Sprintf("key-%d", n)
			s.Set(key, []byte(fmt.Sprintf("val-%d", n)), 0)
			s.Get(key)
			s.Exists(key)
			s.Incr(key+"-counter", 1)
			s.Delete(key)
		}(i)
	}
	wg.Wait()
}

func TestLRUEviction(t *testing.T) {
	// Very small max memory to force eviction.
	s := New(500)
	defer s.Close()

	// Insert enough keys to exceed memory.
	for i := 0; i < 50; i++ {
		s.Set(fmt.Sprintf("key-%d", i), []byte("some-value-data-here"), 0)
	}

	// Memory should be at or under limit after eviction.
	if s.UsedMemory() > 500 {
		t.Fatalf("expected memory to be at or below 500 bytes, got %d", s.UsedMemory())
	}
}

func TestOverwrite(t *testing.T) {
	s := New(0)
	defer s.Close()

	s.Set("key", []byte("first"), 0)
	s.Set("key", []byte("second"), 0)

	val, ok := s.Get("key")
	if !ok || string(val) != "second" {
		t.Fatalf("expected 'second', got %q", string(val))
	}
}
