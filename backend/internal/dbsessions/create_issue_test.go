package dbsessions

import (
	"context"
	"fmt"
	"sync"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type stubSessionStore struct {
	mu         sync.Mutex
	next       int
	started    []sessions.StartSessionParams
	activeByID map[string]sessions.StartSessionParams
}

func (s *stubSessionStore) StartSession(_ context.Context, params sessions.StartSessionParams) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.activeByID == nil {
		s.activeByID = make(map[string]sessions.StartSessionParams)
	}
	s.next++
	sessionID := fmt.Sprintf("sess-%d", s.next)
	s.started = append(s.started, params)
	s.activeByID[sessionID] = params
	return sessionID, nil
}

func (s *stubSessionStore) LoadOwnedSessionState(context.Context, string, string) (*sessions.SessionState, error) {
	return nil, nil
}

func (s *stubSessionStore) UpdateOwnedSessionMetadata(context.Context, string, string, map[string]any) error {
	return nil
}

func (s *stubSessionStore) HeartbeatOwnedSession(context.Context, string, string) error {
	return nil
}

func (s *stubSessionStore) EndOwnedSession(context.Context, string, string, string) error {
	return nil
}

func (s *stubSessionStore) activeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.activeByID)
}

func TestIssueSessionAllowsConcurrentSameConnectionSessions(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{}
	service := Service{Store: store}
	req := SessionIssueRequest{
		TenantID:     "tenant-1",
		UserID:       "user-1",
		ConnectionID: "conn-1",
		Protocol:     "DATABASE",
		IPAddress:    "198.51.100.10",
		ProxyHost:    "proxy.internal",
		ProxyPort:    15432,
		DatabaseName: "warehouse",
		Username:     "db-user",
		Target: &contracts.DatabaseTarget{
			Protocol: "postgresql",
			Host:     "db.internal",
			Port:     5432,
			Database: "warehouse",
			Username: "db-user",
		},
		SessionMetadata: map[string]any{
			"transport": "db-proxy",
		},
	}

	first, err := service.issueSession(context.Background(), req, false)
	if err != nil {
		t.Fatalf("first issueSession() error = %v", err)
	}
	second, err := service.issueSession(context.Background(), req, false)
	if err != nil {
		t.Fatalf("second issueSession() error = %v", err)
	}

	if first.SessionID == "" || second.SessionID == "" || first.SessionID == second.SessionID {
		t.Fatalf("session IDs = %q, %q; want distinct non-empty session IDs", first.SessionID, second.SessionID)
	}
	if got := store.activeCount(); got != 2 {
		t.Fatalf("active session count = %d, want 2", got)
	}
	if len(store.started) != 2 {
		t.Fatalf("started sessions = %d, want 2", len(store.started))
	}
	for i, started := range store.started {
		if started.UserID != req.UserID {
			t.Fatalf("start[%d] userID = %q, want %q", i, started.UserID, req.UserID)
		}
		if started.ConnectionID != req.ConnectionID {
			t.Fatalf("start[%d] connectionID = %q, want %q", i, started.ConnectionID, req.ConnectionID)
		}
		if started.Protocol != "DATABASE" {
			t.Fatalf("start[%d] protocol = %q, want DATABASE", i, started.Protocol)
		}
	}
}
