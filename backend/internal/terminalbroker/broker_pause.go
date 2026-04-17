package terminalbroker

import "time"

func (r *terminalRuntime) setPaused(paused bool) {
	r.pausedMu.Lock()
	r.paused = paused
	r.pausedMu.Unlock()
}

func (r *terminalRuntime) isPaused() bool {
	r.pausedMu.Lock()
	defer r.pausedMu.Unlock()
	return r.paused
}

func (r *terminalRuntime) waitUntilResumed() bool {
	for r.isPaused() {
		select {
		case <-r.closed:
			return false
		case <-time.After(100 * time.Millisecond):
		}
	}
	return true
}

func shouldForwardTerminalClientMessage(messageType string, paused bool) bool {
	if !paused {
		return true
	}
	switch messageType {
	case "ping", "close":
		return true
	default:
		return false
	}
}
