// Package pubsub implements a channel-based pub/sub broker with glob pattern matching.
package pubsub

import (
	"path"
	"sync"
)

const subscriberBufSize = 1000

// Message represents a published message.
type Message struct {
	Channel string
	Data    []byte
}

// Subscriber receives messages on a buffered channel.
type Subscriber struct {
	id      uint64
	Ch      chan Message
	channel string // exact channel or pattern
	pattern bool   // if true, channel is a glob pattern
	closed  bool   // tracks whether Ch has been closed (for idempotent Unsubscribe)
}

// Broker manages pub/sub subscriptions and message delivery.
type Broker struct {
	mu          sync.RWMutex
	nextID      uint64
	exact       map[string]map[uint64]*Subscriber // channel -> subscriber ID -> subscriber
	patterns    map[uint64]*Subscriber             // pattern subscribers
}

// New creates a new Broker.
func New() *Broker {
	return &Broker{
		exact:    make(map[string]map[uint64]*Subscriber),
		patterns: make(map[uint64]*Subscriber),
	}
}

// Subscribe creates a subscriber for an exact channel name.
func (b *Broker) Subscribe(channel string) *Subscriber {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.nextID++
	sub := &Subscriber{
		id:      b.nextID,
		Ch:      make(chan Message, subscriberBufSize),
		channel: channel,
		pattern: false,
	}

	if _, ok := b.exact[channel]; !ok {
		b.exact[channel] = make(map[uint64]*Subscriber)
	}
	b.exact[channel][sub.id] = sub
	return sub
}

// PSubscribe creates a subscriber matching channels by glob pattern.
// Supports * (any sequence) and ? (single character).
func (b *Broker) PSubscribe(pattern string) *Subscriber {
	b.mu.Lock()
	defer b.mu.Unlock()

	b.nextID++
	sub := &Subscriber{
		id:      b.nextID,
		Ch:      make(chan Message, subscriberBufSize),
		channel: pattern,
		pattern: true,
	}
	b.patterns[sub.id] = sub
	return sub
}

// Unsubscribe removes a subscriber. Safe to call multiple times.
func (b *Broker) Unsubscribe(sub *Subscriber) {
	b.mu.Lock()
	defer b.mu.Unlock()

	if sub.closed {
		return // already unsubscribed — idempotent
	}

	if sub.pattern {
		delete(b.patterns, sub.id)
	} else {
		if subs, ok := b.exact[sub.channel]; ok {
			delete(subs, sub.id)
			if len(subs) == 0 {
				delete(b.exact, sub.channel)
			}
		}
	}
	close(sub.Ch)
	sub.closed = true
}

// Publish delivers a message to matching subscribers (at-most-once).
// Returns the number of subscribers that received the message and the
// message itself (for peer replication).
func (b *Broker) Publish(channel string, data []byte) (int, Message) {
	msg := Message{Channel: channel, Data: data}

	b.mu.RLock()
	defer b.mu.RUnlock()

	count := 0

	// Exact subscribers.
	if subs, ok := b.exact[channel]; ok {
		for _, sub := range subs {
			select {
			case sub.Ch <- msg:
				count++
			default:
				// Buffer full, drop (at-most-once).
			}
		}
	}

	// Pattern subscribers.
	for _, sub := range b.patterns {
		matched, _ := path.Match(sub.channel, channel)
		if matched {
			select {
			case sub.Ch <- msg:
				count++
			default:
			}
		}
	}

	return count, msg
}

// DeliverLocal delivers a replicated message to local subscribers without
// returning it for further replication (prevents loops).
func (b *Broker) DeliverLocal(channel string, data []byte) int {
	count, _ := b.Publish(channel, data)
	return count
}
