package sessions

import (
	"errors"
	"testing"
)

func TestHeartbeatSessionStatusPreservesPause(t *testing.T) {
	t.Parallel()

	if got := heartbeatSessionStatus(SessionStatusPaused); got != SessionStatusPaused {
		t.Fatalf("heartbeatSessionStatus(PAUSED) = %q, want %q", got, SessionStatusPaused)
	}
	if got := heartbeatSessionStatus(SessionStatusIdle); got != SessionStatusActive {
		t.Fatalf("heartbeatSessionStatus(IDLE) = %q, want %q", got, SessionStatusActive)
	}
}

func TestNextAdminSessionStatus(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name         string
		current      string
		target       string
		wantStatus   string
		wantChanged  bool
		wantErrMatch error
	}{
		{name: "pause active", current: SessionStatusActive, target: SessionStatusPaused, wantStatus: SessionStatusPaused, wantChanged: true},
		{name: "resume paused", current: SessionStatusPaused, target: SessionStatusActive, wantStatus: SessionStatusActive, wantChanged: true},
		{name: "resume idle", current: SessionStatusIdle, target: SessionStatusActive, wantStatus: SessionStatusActive, wantChanged: true},
		{name: "pause already paused", current: SessionStatusPaused, target: SessionStatusPaused, wantStatus: SessionStatusPaused, wantChanged: false},
		{name: "closed stays closed", current: SessionStatusClosed, target: SessionStatusActive, wantStatus: SessionStatusClosed, wantChanged: false, wantErrMatch: ErrSessionClosed},
	}

	for _, tt := range tests {
		tt := tt
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()

			gotStatus, gotChanged, err := nextAdminSessionStatus(tt.current, tt.target)
			if !errors.Is(err, tt.wantErrMatch) {
				t.Fatalf("nextAdminSessionStatus() error = %v, want %v", err, tt.wantErrMatch)
			}
			if gotStatus != tt.wantStatus {
				t.Fatalf("nextAdminSessionStatus() status = %q, want %q", gotStatus, tt.wantStatus)
			}
			if gotChanged != tt.wantChanged {
				t.Fatalf("nextAdminSessionStatus() changed = %v, want %v", gotChanged, tt.wantChanged)
			}
		})
	}
}
