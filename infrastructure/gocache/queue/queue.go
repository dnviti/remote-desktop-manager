// Package queue implements a per-queue blocking FIFO queue with timeout support.
package queue

import (
	"container/list"
	"context"
	"sync"
	"time"
)

// entry is a queue item.
type entry struct {
	data []byte
}

// queue is a single named queue.
type queue struct {
	mu   sync.Mutex
	cond *sync.Cond
	list *list.List
}

func newQueue() *queue {
	q := &queue{list: list.New()}
	q.cond = sync.NewCond(&q.mu)
	return q
}

// Manager manages named queues.
type Manager struct {
	mu     sync.RWMutex
	queues map[string]*queue
}

// New creates a new queue Manager.
func New() *Manager {
	return &Manager{
		queues: make(map[string]*queue),
	}
}

// getOrCreate returns the queue for a name, creating it if needed.
func (m *Manager) getOrCreate(name string) *queue {
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if ok {
		return q
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	// Double-check after write lock.
	if q, ok = m.queues[name]; ok {
		return q
	}
	q = newQueue()
	m.queues[name] = q
	return q
}

// Enqueue adds a message to the tail of a named queue.
func (m *Manager) Enqueue(name string, data []byte) {
	q := m.getOrCreate(name)
	q.mu.Lock()
	q.list.PushBack(&entry{data: data})
	q.cond.Signal()
	q.mu.Unlock()
}

// DequeueContext removes and returns the head of a named queue, blocking until
// an item is available or ctx is cancelled. Returns (nil, false) on cancellation.
func (m *Manager) DequeueContext(ctx context.Context, name string) ([]byte, bool) {
	q := m.getOrCreate(name)

	q.mu.Lock()
	defer q.mu.Unlock()

	// Fast path: item already available.
	if q.list.Len() > 0 {
		return q.popFront()
	}

	if ctx.Err() != nil {
		return nil, false
	}

	// Single goroutine broadcasts when context expires so cond.Wait unblocks.
	done := make(chan struct{})
	go func() {
		select {
		case <-ctx.Done():
			q.cond.Broadcast()
		case <-done:
		}
	}()
	defer close(done)

	for q.list.Len() == 0 {
		q.cond.Wait()
		if ctx.Err() != nil {
			return nil, false
		}
	}
	return q.popFront()
}

// Dequeue removes and returns the head of a named queue, blocking up to timeout.
// A zero timeout means non-blocking. Returns (nil, false) if no item available.
func (m *Manager) Dequeue(name string, timeout time.Duration) ([]byte, bool) {
	if timeout <= 0 {
		q := m.getOrCreate(name)
		q.mu.Lock()
		defer q.mu.Unlock()
		return q.popFront()
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	return m.DequeueContext(ctx, name)
}

// popFront removes and returns the front item. Caller must hold q.mu.
func (q *queue) popFront() ([]byte, bool) {
	front := q.list.Front()
	if front == nil {
		return nil, false
	}
	e := q.list.Remove(front).(*entry)
	return e.data, true
}

// Len returns the number of items in the named queue.
func (m *Manager) Len(name string) int {
	m.mu.RLock()
	q, ok := m.queues[name]
	m.mu.RUnlock()
	if !ok {
		return 0
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.list.Len()
}
