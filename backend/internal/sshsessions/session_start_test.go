package sshsessions

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
)

type stubSessionStore struct {
	mu         sync.Mutex
	next       int
	started    []sessions.StartSessionParams
	ended      []ownedSessionEndCall
	activeByID map[string]sessions.StartSessionParams
}

type ownedSessionEndCall struct {
	SessionID string
	UserID    string
	Reason    string
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

func (s *stubSessionStore) EndOwnedSession(_ context.Context, sessionID, userID, reason string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.activeByID, sessionID)
	s.ended = append(s.ended, ownedSessionEndCall{SessionID: sessionID, UserID: userID, Reason: reason})
	return nil
}

func (s *stubSessionStore) HeartbeatOwnedSession(context.Context, string, string) error {
	return nil
}

func (s *stubSessionStore) activeCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.activeByID)
}

func TestStartResolvedSSHSessionAllowsConcurrentSameConnectionSessions(t *testing.T) {
	t.Parallel()

	var (
		grantMu       sync.Mutex
		grantSessions []string
	)
	grantServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/session-grants:issue" {
			t.Fatalf("path = %q, want /v1/session-grants:issue", r.URL.Path)
		}
		defer r.Body.Close()

		var payload struct {
			Grant map[string]any `json:"grant"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode grant payload: %v", err)
		}
		sessionID, _ := payload.Grant["sessionId"].(string)
		grantMu.Lock()
		grantSessions = append(grantSessions, sessionID)
		grantMu.Unlock()

		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(terminalGrantIssueResponse{Token: "grant-token", ExpiresAt: time.Now().UTC().Add(time.Minute)})
	}))
	defer grantServer.Close()

	store := &stubSessionStore{}
	service := Service{
		SessionStore:      store,
		TerminalBrokerURL: grantServer.URL,
		HTTPClient:        grantServer.Client(),
	}
	claims := authn.Claims{UserID: "user-1", TenantID: "tenant-1"}
	access := connectionAccess{Connection: connectionRecord{ID: "conn-1", Host: "ssh.internal", Port: 22}}
	credentials := resolvedCredentials{Username: "alice", Password: "secret", CredentialSource: "vault"}

	first, err := service.startResolvedSSHSession(context.Background(), claims, access, credentials, "198.51.100.10", "gw-1", "inst-1", nil, policySnapshot{}, nil)
	if err != nil {
		t.Fatalf("first startResolvedSSHSession() error = %v", err)
	}
	second, err := service.startResolvedSSHSession(context.Background(), claims, access, credentials, "198.51.100.10", "gw-1", "inst-1", nil, policySnapshot{}, nil)
	if err != nil {
		t.Fatalf("second startResolvedSSHSession() error = %v", err)
	}

	if first.SessionID == "" || second.SessionID == "" || first.SessionID == second.SessionID {
		t.Fatalf("session IDs = %q, %q; want distinct non-empty session IDs", first.SessionID, second.SessionID)
	}
	if got := store.activeCount(); got != 2 {
		t.Fatalf("active session count = %d, want 2", got)
	}
	if len(store.ended) != 0 {
		t.Fatalf("ended sessions = %d, want 0", len(store.ended))
	}
	if len(store.started) != 2 {
		t.Fatalf("started sessions = %d, want 2", len(store.started))
	}
	for i, started := range store.started {
		if started.UserID != claims.UserID {
			t.Fatalf("start[%d] userID = %q, want %q", i, started.UserID, claims.UserID)
		}
		if started.ConnectionID != access.Connection.ID {
			t.Fatalf("start[%d] connectionID = %q, want %q", i, started.ConnectionID, access.Connection.ID)
		}
		if started.Protocol != "SSH" {
			t.Fatalf("start[%d] protocol = %q, want SSH", i, started.Protocol)
		}
	}
	grantMu.Lock()
	defer grantMu.Unlock()
	if len(grantSessions) != 2 {
		t.Fatalf("grant requests = %d, want 2", len(grantSessions))
	}
	if grantSessions[0] != first.SessionID || grantSessions[1] != second.SessionID {
		t.Fatalf("grant session IDs = %#v, want [%q %q]", grantSessions, first.SessionID, second.SessionID)
	}
}

func TestStartDBTunnelSessionAllowsConcurrentSameConnectionSessions(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{}
	service := Service{SessionStore: store}
	claims := authn.Claims{UserID: "user-1", TenantID: "tenant-1"}
	access := connectionAccess{Connection: connectionRecord{ID: "conn-1", Host: "bastion.internal", Port: 22}}
	credentials := resolvedCredentials{CredentialSource: "vault"}
	dbType := "postgresql"
	firstTunnel := &activeDBTunnel{ID: "tun-1", LocalPort: 15432, ConnectionString: cloneStringPtr(&dbType)}
	firstConnString := "postgresql://127.0.0.1:15432/app"
	firstTunnel.ConnectionString = &firstConnString
	secondTunnel := &activeDBTunnel{ID: "tun-2", LocalPort: 15433}
	secondConnString := "postgresql://127.0.0.1:15433/app"
	secondTunnel.ConnectionString = &secondConnString

	firstID, err := service.startDBTunnelSession(context.Background(), claims, access, "198.51.100.10", firstTunnel, credentials, "db.internal", 5432, &dbType)
	if err != nil {
		t.Fatalf("first startDBTunnelSession() error = %v", err)
	}
	secondID, err := service.startDBTunnelSession(context.Background(), claims, access, "198.51.100.10", secondTunnel, credentials, "db.internal", 5432, &dbType)
	if err != nil {
		t.Fatalf("second startDBTunnelSession() error = %v", err)
	}

	if firstID == "" || secondID == "" || firstID == secondID {
		t.Fatalf("session IDs = %q, %q; want distinct non-empty session IDs", firstID, secondID)
	}
	if got := store.activeCount(); got != 2 {
		t.Fatalf("active session count = %d, want 2", got)
	}
	if len(store.ended) != 0 {
		t.Fatalf("ended sessions = %d, want 0", len(store.ended))
	}
	if len(store.started) != 2 {
		t.Fatalf("started sessions = %d, want 2", len(store.started))
	}
	if got := store.started[0].Metadata["tunnelId"]; got != firstTunnel.ID {
		t.Fatalf("first tunnelId = %v, want %q", got, firstTunnel.ID)
	}
	if got := store.started[1].Metadata["tunnelId"]; got != secondTunnel.ID {
		t.Fatalf("second tunnelId = %v, want %q", got, secondTunnel.ID)
	}
	for i, started := range store.started {
		if started.ConnectionID != access.Connection.ID {
			t.Fatalf("start[%d] connectionID = %q, want %q", i, started.ConnectionID, access.Connection.ID)
		}
		if started.Protocol != "DB_TUNNEL" {
			t.Fatalf("start[%d] protocol = %q, want DB_TUNNEL", i, started.Protocol)
		}
	}
}
