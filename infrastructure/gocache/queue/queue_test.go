package queue

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestEnqueueDequeue(t *testing.T) {
	m := New()
	m.Enqueue("q", []byte("first"))
	m.Enqueue("q", []byte("second"))

	data, ok := m.Dequeue("q", 0)
	if !ok || string(data) != "first" {
		t.Fatalf("expected 'first', got %q (ok=%v)", string(data), ok)
	}
	data, ok = m.Dequeue("q", 0)
	if !ok || string(data) != "second" {
		t.Fatalf("expected 'second', got %q (ok=%v)", string(data), ok)
	}
}

func TestDequeueEmpty(t *testing.T) {
	m := New()
	data, ok := m.Dequeue("empty", 0)
	if ok || data != nil {
		t.Fatal("expected nil/false from empty queue")
	}
}

func TestBlockingDequeueWithTimeout(t *testing.T) {
	m := New()
	start := time.Now()
	data, ok := m.Dequeue("q", 100*time.Millisecond)
	elapsed := time.Since(start)

	if ok || data != nil {
		t.Fatal("expected nil/false on timeout")
	}
	if elapsed < 80*time.Millisecond {
		t.Fatalf("returned too quickly: %v", elapsed)
	}
}

func TestBlockingDequeueUnblocksOnEnqueue(t *testing.T) {
	m := New()
	var wg sync.WaitGroup
	wg.Add(1)

	var result []byte
	var found bool
	go func() {
		defer wg.Done()
		result, found = m.Dequeue("q", 5*time.Second)
	}()

	// Give the goroutine time to start blocking.
	time.Sleep(50 * time.Millisecond)
	m.Enqueue("q", []byte("hello"))
	wg.Wait()

	if !found || string(result) != "hello" {
		t.Fatalf("expected 'hello', got %q (found=%v)", string(result), found)
	}
}

func TestDequeueContextCancellation(t *testing.T) {
	m := New()
	ctx, cancel := context.WithCancel(context.Background())

	var wg sync.WaitGroup
	wg.Add(1)

	var found bool
	go func() {
		defer wg.Done()
		_, found = m.DequeueContext(ctx, "q")
	}()

	time.Sleep(50 * time.Millisecond)
	cancel()
	wg.Wait()

	if found {
		t.Fatal("expected false after context cancellation")
	}
}

func TestConcurrentEnqueueDequeue(t *testing.T) {
	m := New()
	const n = 100

	var wg sync.WaitGroup

	// Producers.
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m.Enqueue("q", []byte("item"))
		}()
	}

	// Wait for all enqueues.
	wg.Wait()

	if m.Len("q") != n {
		t.Fatalf("expected %d items, got %d", n, m.Len("q"))
	}

	// Consumers.
	var consumed int
	var mu sync.Mutex
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			_, ok := m.Dequeue("q", 0)
			if ok {
				mu.Lock()
				consumed++
				mu.Unlock()
			}
		}()
	}
	wg.Wait()

	if consumed != n {
		t.Fatalf("expected %d consumed, got %d", n, consumed)
	}
	if m.Len("q") != 0 {
		t.Fatalf("expected empty queue, got %d", m.Len("q"))
	}
}

func TestLen(t *testing.T) {
	m := New()
	if m.Len("q") != 0 {
		t.Fatal("expected 0 for non-existent queue")
	}
	m.Enqueue("q", []byte("a"))
	m.Enqueue("q", []byte("b"))
	if m.Len("q") != 2 {
		t.Fatalf("expected 2, got %d", m.Len("q"))
	}
}
