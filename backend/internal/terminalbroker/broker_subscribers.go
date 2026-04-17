package terminalbroker

import (
	"encoding/json"
	"io"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"github.com/gorilla/websocket"
)

func newTerminalSubscriber(runtime *terminalRuntime, wsConn *websocket.Conn, mode contracts.TerminalSessionMode, ownsRuntime bool) *terminalSubscriber {
	return &terminalSubscriber{
		logger:      runtime.logger,
		runtime:     runtime,
		wsConn:      wsConn,
		mode:        mode,
		ownsRuntime: ownsRuntime,
		closed:      make(chan struct{}),
	}
}

func (r *terminalRuntime) attachSubscriber(subscriber *terminalSubscriber) bool {
	if subscriber == nil {
		return false
	}

	select {
	case <-r.closed:
		return false
	default:
	}

	r.subscribersMu.Lock()
	defer r.subscribersMu.Unlock()
	select {
	case <-r.closed:
		return false
	default:
	}

	if subscriber.ownsRuntime {
		if r.owner != nil {
			return false
		}
		r.owner = subscriber
		return true
	}
	if r.observers == nil {
		r.observers = make(map[*terminalSubscriber]struct{})
	}
	r.observers[subscriber] = struct{}{}
	return true
}

func (r *terminalRuntime) removeSubscriber(subscriber *terminalSubscriber) {
	r.subscribersMu.Lock()
	defer r.subscribersMu.Unlock()
	if r.owner == subscriber {
		r.owner = nil
		return
	}
	delete(r.observers, subscriber)
}

func (r *terminalRuntime) snapshotSubscribers() []*terminalSubscriber {
	r.subscribersMu.Lock()
	defer r.subscribersMu.Unlock()
	result := make([]*terminalSubscriber, 0, 1+len(r.observers))
	if r.owner != nil {
		result = append(result, r.owner)
	}
	for subscriber := range r.observers {
		result = append(result, subscriber)
	}
	return result
}

func (r *terminalRuntime) closeSubscribers() {
	for _, subscriber := range r.snapshotSubscribers() {
		_ = subscriber.send(serverMessage{Type: "closed"})
		subscriber.closeFromRuntime()
	}

	r.subscribersMu.Lock()
	r.owner = nil
	r.observers = make(map[*terminalSubscriber]struct{})
	r.subscribersMu.Unlock()
}

func (r *terminalRuntime) broadcast(message serverMessage) bool {
	for _, subscriber := range r.snapshotSubscribers() {
		if err := subscriber.send(message); err != nil {
			if subscriber.ownsRuntime {
				r.close()
				return false
			}
			subscriber.disconnect()
		}
	}
	return true
}

func (s *terminalSubscriber) readWebSocket() {
	for {
		_, payload, err := s.wsConn.ReadMessage()
		if err != nil {
			s.handleReadFailure()
			return
		}

		var message clientMessage
		if err := json.Unmarshal(payload, &message); err != nil {
			s.failProtocol("invalid websocket payload")
			return
		}

		if !s.handleClientMessage(message) {
			return
		}
	}
}

func (s *terminalSubscriber) handleClientMessage(message clientMessage) bool {
	if s.mode == contracts.TerminalSessionModeObserve {
		return s.handleObserverMessage(message)
	}
	if !shouldForwardTerminalClientMessage(message.Type, s.runtime.isPaused()) {
		return true
	}

	switch message.Type {
	case "input":
		if _, err := io.WriteString(s.runtime.stdin, message.Data); err != nil {
			_ = s.send(serverMessage{Type: "error", Code: "WRITE_ERROR", Message: "failed to send terminal input"})
			s.runtime.close()
			return false
		}
		s.runtime.noteActivity(false)
		return true
	case "resize":
		if message.Cols > 0 && message.Rows > 0 {
			_ = s.runtime.session.WindowChange(message.Rows, message.Cols)
		}
		s.runtime.noteActivity(false)
		return true
	case "ping":
		s.runtime.noteActivity(true)
		if err := s.send(serverMessage{Type: "pong"}); err != nil {
			s.runtime.close()
			return false
		}
		return true
	case "close":
		s.runtime.close()
		return false
	default:
		s.failProtocol("unsupported terminal message")
		return false
	}
}

func (s *terminalSubscriber) handleObserverMessage(message clientMessage) bool {
	switch message.Type {
	case "ping":
		if err := s.send(serverMessage{Type: "pong"}); err != nil {
			s.disconnect()
			return false
		}
		return true
	case "close":
		s.disconnect()
		return false
	case "input", "resize":
		if err := s.send(serverMessage{Type: "error", Code: "READ_ONLY", Message: "observer connection is read-only"}); err != nil {
			s.disconnect()
			return false
		}
		return true
	default:
		s.failProtocol("unsupported terminal message")
		return false
	}
}

func (s *terminalSubscriber) failProtocol(message string) {
	_ = s.send(serverMessage{Type: "error", Code: "PROTOCOL_ERROR", Message: message})
	if s.ownsRuntime {
		s.runtime.close()
		return
	}
	s.disconnect()
}

func (s *terminalSubscriber) handleReadFailure() {
	if s.ownsRuntime {
		s.runtime.close()
		return
	}
	s.disconnect()
}

func (s *terminalSubscriber) send(message serverMessage) error {
	s.writeMu.Lock()
	defer s.writeMu.Unlock()
	return sendWebsocketMessage(s.wsConn, message)
}

func (s *terminalSubscriber) disconnect() {
	s.closeOnce.Do(func() {
		s.runtime.removeSubscriber(s)
		closeWebSocketConnection(s.wsConn, websocket.CloseNormalClosure, "")
		close(s.closed)
	})
}

func (s *terminalSubscriber) closeFromRuntime() {
	s.closeOnce.Do(func() {
		closeWebSocketConnection(s.wsConn, websocket.CloseNormalClosure, "")
		close(s.closed)
	})
}
