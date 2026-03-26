package pubsub

import (
	"testing"
	"time"
)

func TestSubscribeAndPublish(t *testing.T) {
	b := New()
	sub := b.Subscribe("events")
	defer b.Unsubscribe(sub)

	count, _ := b.Publish("events", []byte("hello"))
	if count != 1 {
		t.Fatalf("expected 1 receiver, got %d", count)
	}

	select {
	case msg := <-sub.Ch:
		if string(msg.Data) != "hello" {
			t.Fatalf("expected 'hello', got %q", string(msg.Data))
		}
		if msg.Channel != "events" {
			t.Fatalf("expected channel 'events', got %q", msg.Channel)
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for message")
	}
}

func TestPatternMatching(t *testing.T) {
	b := New()
	sub := b.PSubscribe("user.*")
	defer b.Unsubscribe(sub)

	b.Publish("user.login", []byte("alice"))
	b.Publish("user.logout", []byte("bob"))
	b.Publish("system.start", []byte("nope"))

	received := 0
	timeout := time.After(time.Second)
loop:
	for {
		select {
		case <-sub.Ch:
			received++
			if received == 2 {
				break loop
			}
		case <-timeout:
			break loop
		}
	}

	if received != 2 {
		t.Fatalf("expected 2 pattern-matched messages, got %d", received)
	}
}

func TestUnsubscribe(t *testing.T) {
	b := New()
	sub := b.Subscribe("ch")
	b.Unsubscribe(sub)

	count, _ := b.Publish("ch", []byte("data"))
	if count != 0 {
		t.Fatalf("expected 0 receivers after unsubscribe, got %d", count)
	}
}

func TestMultipleSubscribers(t *testing.T) {
	b := New()
	sub1 := b.Subscribe("shared")
	sub2 := b.Subscribe("shared")
	defer b.Unsubscribe(sub1)
	defer b.Unsubscribe(sub2)

	count, _ := b.Publish("shared", []byte("broadcast"))
	if count != 2 {
		t.Fatalf("expected 2 receivers, got %d", count)
	}

	for _, sub := range []*Subscriber{sub1, sub2} {
		select {
		case msg := <-sub.Ch:
			if string(msg.Data) != "broadcast" {
				t.Fatalf("expected 'broadcast', got %q", string(msg.Data))
			}
		case <-time.After(time.Second):
			t.Fatal("timed out waiting for message")
		}
	}
}

func TestNoMatchPublish(t *testing.T) {
	b := New()
	count, _ := b.Publish("nobody-listening", []byte("data"))
	if count != 0 {
		t.Fatalf("expected 0 receivers, got %d", count)
	}
}

func TestPatternQuestionMark(t *testing.T) {
	b := New()
	sub := b.PSubscribe("log.?")
	defer b.Unsubscribe(sub)

	b.Publish("log.a", []byte("match"))
	b.Publish("log.ab", []byte("no-match"))

	select {
	case msg := <-sub.Ch:
		if string(msg.Data) != "match" {
			t.Fatalf("expected 'match', got %q", string(msg.Data))
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for pattern match")
	}

	select {
	case <-sub.Ch:
		t.Fatal("should not have received second message")
	case <-time.After(100 * time.Millisecond):
		// Good, no second message.
	}
}
