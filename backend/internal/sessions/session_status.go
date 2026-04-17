package sessions

import "strings"

const (
	SessionStatusActive = "ACTIVE"
	SessionStatusIdle   = "IDLE"
	SessionStatusPaused = "PAUSED"
	SessionStatusClosed = "CLOSED"
)

func normalizeSessionStatus(status string) string {
	switch strings.ToUpper(strings.TrimSpace(status)) {
	case SessionStatusPaused:
		return SessionStatusPaused
	case SessionStatusClosed:
		return SessionStatusClosed
	case SessionStatusIdle:
		return SessionStatusIdle
	default:
		return SessionStatusActive
	}
}

func heartbeatSessionStatus(status string) string {
	if normalizeSessionStatus(status) == SessionStatusPaused {
		return SessionStatusPaused
	}
	return SessionStatusActive
}

func nextAdminSessionStatus(currentStatus, targetStatus string) (string, bool, error) {
	current := normalizeSessionStatus(currentStatus)
	target := normalizeSessionStatus(targetStatus)
	if current == SessionStatusClosed {
		return current, false, ErrSessionClosed
	}
	if current == target {
		return current, false, nil
	}
	if target == SessionStatusPaused {
		return SessionStatusPaused, true, nil
	}
	return SessionStatusActive, true, nil
}
