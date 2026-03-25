package audit

import (
	"encoding/json"
	"sync"
	"testing"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

func TestReportEventSerialization(t *testing.T) {
	var received []*protocol.Frame
	var mu sync.Mutex
	var wg sync.WaitGroup

	wg.Add(1)
	sender := func(frame *protocol.Frame) error {
		defer wg.Done()
		mu.Lock()
		received = append(received, frame)
		mu.Unlock()
		return nil
	}

	reporter := NewAuditReporter(sender, 16)
	reporter.Start()

	reporter.ReportEvent("sess-1", EventSessionStarted, map[string]string{
		"protocol": "ssh",
		"host":     "10.0.0.1",
	})

	wg.Wait()
	reporter.Stop()

	mu.Lock()
	defer mu.Unlock()

	if len(received) != 1 {
		t.Fatalf("expected 1 frame, got %d", len(received))
	}

	frame := received[0]
	if frame.Type != protocol.MsgSessionEvent {
		t.Errorf("frame type: got %d, want %d", frame.Type, protocol.MsgSessionEvent)
	}

	var evt Event
	if err := json.Unmarshal(frame.Payload, &evt); err != nil {
		t.Fatalf("unmarshal event: %v", err)
	}
	if evt.SessionID != "sess-1" {
		t.Errorf("sessionId: got %q, want %q", evt.SessionID, "sess-1")
	}
	if evt.EventType != EventSessionStarted {
		t.Errorf("eventType: got %q, want %q", evt.EventType, EventSessionStarted)
	}
	if evt.Metadata["protocol"] != "ssh" {
		t.Errorf("metadata[protocol]: got %q, want %q", evt.Metadata["protocol"], "ssh")
	}
}

func TestReportMultipleEvents(t *testing.T) {
	var received []*protocol.Frame
	var mu sync.Mutex
	var wg sync.WaitGroup

	sender := func(frame *protocol.Frame) error {
		defer wg.Done()
		mu.Lock()
		received = append(received, frame)
		mu.Unlock()
		return nil
	}

	reporter := NewAuditReporter(sender, 16)
	reporter.Start()

	events := []string{
		EventSessionStarted,
		EventCredentialUsed,
		EventQueryExecuted,
		EventSessionEnded,
	}

	wg.Add(len(events))
	for _, et := range events {
		reporter.ReportEvent("sess-2", et, nil)
	}

	wg.Wait()
	reporter.Stop()

	mu.Lock()
	defer mu.Unlock()

	if len(received) != len(events) {
		t.Fatalf("expected %d frames, got %d", len(events), len(received))
	}
}

func TestReporterStopDrainsEvents(t *testing.T) {
	var count int
	var mu sync.Mutex

	sender := func(_ *protocol.Frame) error {
		mu.Lock()
		count++
		mu.Unlock()
		return nil
	}

	reporter := NewAuditReporter(sender, 256)
	reporter.Start()

	// Submit many events quickly
	for i := 0; i < 50; i++ {
		reporter.ReportEvent("sess-drain", EventSessionStarted, nil)
	}

	reporter.Stop()

	mu.Lock()
	defer mu.Unlock()
	if count != 50 {
		t.Errorf("expected 50 events drained, got %d", count)
	}
}

func TestReporterIgnoresAfterStop(t *testing.T) {
	var count int
	var mu sync.Mutex

	sender := func(_ *protocol.Frame) error {
		mu.Lock()
		count++
		mu.Unlock()
		return nil
	}

	reporter := NewAuditReporter(sender, 16)
	reporter.Start()
	reporter.Stop()

	// This should not panic or send
	reporter.ReportEvent("sess-after", EventSessionStarted, nil)

	mu.Lock()
	defer mu.Unlock()
	// count should be 0 — nothing was sent before Stop
	if count != 0 {
		t.Errorf("expected 0 events after stop, got %d", count)
	}
}
