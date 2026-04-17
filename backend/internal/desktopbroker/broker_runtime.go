package desktopbroker

import (
	"context"
	"errors"
	"io"
	"strings"
	"time"

	"github.com/gorilla/websocket"
)

var desktopSessionStatePollInterval = 5 * time.Second

func (s *guacSession) run(ctx context.Context) {
	s.closed = make(chan struct{})

	if err := s.writeGuacd([]byte(EncodeInstruction("select", s.settings.Selector))); err != nil {
		s.sendErrorAndClose("Desktop service unavailable", "SERVICE_UNAVAILABLE")
		s.finalize()
		return
	}

	go s.monitorSessionState()
	go s.readWebSocket()
	s.readGuacd()
	s.finalize()

	select {
	case <-ctx.Done():
	case <-s.closed:
	}
}

func (s *guacSession) readWebSocket() {
	for {
		messageType, payload, err := s.wsConn.ReadMessage()
		if err != nil {
			s.closeAll()
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}
		if s.isPaused() {
			continue
		}

		s.bufferMu.Lock()
		if s.ready {
			s.bufferMu.Unlock()
			if err := s.writeGuacd(payload); err != nil {
				s.logger.Warn("write guacd failed", "error", err)
				s.sendErrorAndClose("Desktop connection failed", "CONNECTION_ERROR")
				return
			}
			continue
		}
		s.pending = append(s.pending, append([]byte(nil), payload...))
		s.bufferMu.Unlock()
	}
}

func (s *guacSession) readGuacd() {
	decoder := &Decoder{}
	buffer := make([]byte, 8192)
	for {
		if s.isReady() && !s.waitUntilResumed() {
			return
		}
		n, err := s.guacdConn.Read(buffer)
		if n > 0 {
			instructions, decodeErr := decoder.Feed(buffer[:n])
			if decodeErr != nil {
				s.logger.Warn("decode guacd instruction failed", "error", decodeErr)
				s.sendErrorAndClose("Desktop connection failed", "PROTOCOL_ERROR")
				return
			}
			for _, instruction := range instructions {
				if shouldPauseDesktopInstruction(instruction) && !s.waitUntilResumed() {
					return
				}
				if err := s.handleGuacdInstruction(instruction); err != nil {
					s.logger.Warn("handle guacd instruction failed", "instruction", instruction[0], "error", err)
					s.sendErrorAndClose("Desktop connection failed", "CONNECTION_ERROR")
					return
				}
			}
		}
		if err != nil {
			if !errors.Is(err, io.EOF) {
				s.logger.Warn("guacd read error", "error", err)
			}
			s.closeAll()
			return
		}
	}
}

func (s *guacSession) handleGuacdInstruction(instruction []string) error {
	if len(instruction) == 0 {
		return nil
	}

	switch instruction[0] {
	case "args":
		messages, err := BuildHandshakeMessages(s.settings, instruction[1:])
		if err != nil {
			return err
		}
		for _, message := range messages {
			if err := s.writeGuacd([]byte(message)); err != nil {
				return err
			}
		}
		return nil
	case "ready":
		readyPayload := ""
		if len(instruction) > 1 {
			readyPayload = instruction[1]
		}
		if err := s.recordReadyConnection(readyPayload); err != nil {
			return err
		}
		s.bufferMu.Lock()
		s.ready = true
		pending := s.pending
		s.pending = nil
		s.bufferMu.Unlock()

		if err := s.writeWebSocket(EncodeInstruction("ready", readyPayload)); err != nil {
			return err
		}
		s.bufferMu.Lock()
		s.pending = append(pending, s.pending...)
		s.bufferMu.Unlock()
		if s.isPaused() {
			return nil
		}
		return s.flushPending()
	case "error":
		s.logger.Warn("guacd error instruction", "instruction", instruction)
		if err := s.writeWebSocket(EncodeInstruction(instruction...)); err != nil {
			return err
		}
		s.closeAll()
		return nil
	default:
		return s.writeWebSocket(EncodeInstruction(instruction...))
	}
}

func (s *guacSession) writeGuacd(payload []byte) error {
	s.guacdWriteMu.Lock()
	defer s.guacdWriteMu.Unlock()
	_, err := s.guacdConn.Write(payload)
	return err
}

func (s *guacSession) writeWebSocket(message string) error {
	s.wsWriteMu.Lock()
	defer s.wsWriteMu.Unlock()
	return s.wsConn.WriteMessage(websocket.TextMessage, []byte(message))
}

func (s *guacSession) sendErrorAndClose(message, code string) {
	_ = s.writeWebSocket(EncodeInstruction("error", message, code))
	s.closeAll()
}

func (s *guacSession) finalize() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := s.sessionStore.FinalizeDesktopSession(ctx, s.tokenHash, s.recordingID); err != nil {
		s.logger.Warn("finalize desktop session", "error", err)
	}
}

func (s *guacSession) closeAll() {
	s.closeOnce.Do(func() {
		close(s.closed)
		_ = s.guacdConn.Close()
		_ = s.wsConn.Close()
	})
}

func (s *guacSession) flushPending() error {
	s.bufferMu.Lock()
	if !s.ready || len(s.pending) == 0 {
		s.bufferMu.Unlock()
		return nil
	}
	pending := s.pending
	s.pending = nil
	s.bufferMu.Unlock()

	for _, message := range pending {
		if err := s.writeGuacd(message); err != nil {
			return err
		}
	}
	return nil
}

func (s *guacSession) monitorSessionState() {
	stateSessionID := strings.TrimSpace(s.stateSessionID)
	tokenHash := strings.TrimSpace(s.tokenHash)
	if stateSessionID == "" && tokenHash == "" {
		return
	}

	ticker := time.NewTicker(desktopSessionStatePollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-s.closed:
			return
		case <-ticker.C:
			state, err := s.loadSessionState(context.Background(), stateSessionID, tokenHash)
			if err != nil {
				s.logger.Warn("load desktop session state failed", "error", err)
				continue
			}
			if !state.Exists {
				continue
			}

			wasPaused := s.setPaused(state.Paused)
			if !state.Paused && wasPaused {
				if err := s.flushPending(); err != nil {
					s.sendErrorAndClose("Desktop connection failed", "CONNECTION_ERROR")
					return
				}
			}
			if !state.Closed {
				continue
			}

			s.setPaused(false)
			switch state.Reason {
			case "admin_terminated":
				s.sendErrorAndClose("Session terminated by administrator", "SESSION_TERMINATED")
			case "timeout":
				s.sendErrorAndClose("Session expired due to inactivity", "SESSION_TIMEOUT")
			default:
				s.sendErrorAndClose("Session closed", "SESSION_CLOSED")
			}
			return
		}
	}
}

func (s *guacSession) recordReadyConnection(connectionID string) error {
	connectionID = strings.TrimSpace(connectionID)
	if connectionID == "" {
		return nil
	}
	return s.sessionStore.RecordDesktopConnectionReady(context.Background(), s.tokenHash, connectionID)
}

func (s *guacSession) loadSessionState(ctx context.Context, stateSessionID, tokenHash string) (DesktopSessionState, error) {
	if stateSessionID != "" {
		return s.sessionStore.GetDesktopSessionStateBySessionID(ctx, stateSessionID)
	}
	return s.sessionStore.GetDesktopSessionState(ctx, tokenHash)
}
