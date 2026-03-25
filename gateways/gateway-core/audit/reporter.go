// Package audit provides non-blocking audit event reporting for Arsenale
// gateway sessions. Events are serialized as SESSION_EVENT frames and sent
// over the tunnel.
package audit

import (
	"encoding/json"
	"log"
	"sync"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// Event type constants for audit reporting.
const (
	EventSessionStarted    = "SESSION_STARTED"
	EventSessionEnded      = "SESSION_ENDED"
	EventCredentialUsed    = "CREDENTIAL_USED"
	EventQueryExecuted     = "QUERY_EXECUTED"
	EventFileTransferred   = "FILE_TRANSFERRED"
	EventKeystrokeDetected = "KEYSTROKE_DETECTED"
	EventPolicyViolated    = "POLICY_VIOLATED"
)

// Event represents a single audit event to be reported.
type Event struct {
	SessionID string            `json:"sessionId"`
	EventType string            `json:"eventType"`
	Metadata  map[string]string `json:"metadata,omitempty"`
}

// FrameSender is the function signature for sending a protocol frame.
// Typically this is TunnelClient.SendFrame.
type FrameSender func(frame *protocol.Frame) error

// AuditReporter sends audit events as SESSION_EVENT frames over the tunnel.
// It uses a buffered channel for non-blocking event submission.
type AuditReporter struct {
	sender  FrameSender
	eventCh chan Event
	wg      sync.WaitGroup
	stopCh  chan struct{}
	stopped bool
	started bool
	mu      sync.Mutex
}

// NewAuditReporter creates a new reporter with the given frame sender and
// buffer size. Call Start() to begin processing events.
func NewAuditReporter(sender FrameSender, bufferSize int) *AuditReporter {
	if bufferSize <= 0 {
		bufferSize = 256
	}
	return &AuditReporter{
		sender:  sender,
		eventCh: make(chan Event, bufferSize),
		stopCh:  make(chan struct{}),
	}
}

// Start begins the background event processing goroutine. It is idempotent —
// calling Start() multiple times has no effect after the first call.
func (ar *AuditReporter) Start() {
	ar.mu.Lock()
	if ar.started {
		ar.mu.Unlock()
		return
	}
	ar.started = true
	ar.mu.Unlock()

	ar.wg.Add(1)
	go ar.processLoop()
}

// Stop gracefully shuts down the reporter, draining any remaining events.
func (ar *AuditReporter) Stop() {
	ar.mu.Lock()
	if ar.stopped {
		ar.mu.Unlock()
		return
	}
	ar.stopped = true
	ar.mu.Unlock()

	close(ar.stopCh)
	ar.wg.Wait()
}

// ReportEvent submits an audit event for asynchronous delivery. It is
// non-blocking: if the buffer is full the event is dropped with a warning.
func (ar *AuditReporter) ReportEvent(sessionID, eventType string, metadata map[string]string) {
	ar.mu.Lock()
	if ar.stopped {
		ar.mu.Unlock()
		return
	}
	ar.mu.Unlock()

	evt := Event{
		SessionID: sessionID,
		EventType: eventType,
		Metadata:  metadata,
	}

	select {
	case ar.eventCh <- evt:
	default:
		log.Printf("[audit] Event buffer full — dropping %s event for session %s", eventType, sessionID)
	}
}

// processLoop reads events from the channel and sends them as frames.
func (ar *AuditReporter) processLoop() {
	defer ar.wg.Done()

	for {
		select {
		case evt := <-ar.eventCh:
			ar.sendEvent(evt)
		case <-ar.stopCh:
			// Drain remaining events
			for {
				select {
				case evt := <-ar.eventCh:
					ar.sendEvent(evt)
				default:
					return
				}
			}
		}
	}
}

// sendEvent serializes an event and sends it as a SESSION_EVENT frame.
func (ar *AuditReporter) sendEvent(evt Event) {
	payload, err := json.Marshal(evt)
	if err != nil {
		log.Printf("[audit] Failed to marshal event: %v", err)
		return
	}

	frame := &protocol.Frame{
		Type:    protocol.MsgSessionEvent,
		Payload: payload,
	}

	if err := ar.sender(frame); err != nil {
		log.Printf("[audit] Failed to send %s event for session %s: %v", evt.EventType, evt.SessionID, err)
	}
}
