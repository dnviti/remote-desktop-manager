package desktopbroker

import "time"

func (s *guacSession) setPaused(paused bool) bool {
	s.pausedMu.Lock()
	changed := s.paused != paused
	s.paused = paused
	s.pausedMu.Unlock()
	return changed
}

func (s *guacSession) isPaused() bool {
	s.pausedMu.Lock()
	defer s.pausedMu.Unlock()
	return s.paused
}

func (s *guacSession) isReady() bool {
	s.bufferMu.Lock()
	defer s.bufferMu.Unlock()
	return s.ready
}

func (s *guacSession) waitUntilResumed() bool {
	for s.isPaused() {
		select {
		case <-s.closed:
			return false
		case <-time.After(100 * time.Millisecond):
		}
	}
	return true
}

func shouldPauseDesktopInstruction(instruction []string) bool {
	if len(instruction) == 0 {
		return false
	}
	switch instruction[0] {
	case "args", "ready", "error":
		return false
	default:
		return true
	}
}
