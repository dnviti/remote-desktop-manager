package sessionadmin

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type stubSessionStore struct {
	listItems         []sessions.ActiveSessionDTO
	listErr           error
	listCalled        bool
	lastListFilter    sessions.ActiveSessionFilter
	countValue        int
	lastCountFilter   sessions.ActiveSessionFilter
	consoleItems      []sessions.SessionConsoleDTO
	consoleCount      int
	lastConsoleFilter sessions.SessionConsoleFilter
	observeItem       *sessions.TenantSessionSummary
	observeErr        error
	pauseResult       *sessions.SessionControlResult
	pauseErr          error
	resumeErr         error
	termResult        *sessions.TerminatedSession
	termErr           error
	lastIP            *string
}

func (s *stubSessionStore) ListActiveSessions(_ context.Context, filter sessions.ActiveSessionFilter) ([]sessions.ActiveSessionDTO, error) {
	s.listCalled = true
	s.lastListFilter = filter
	return s.listItems, s.listErr
}

func (s *stubSessionStore) CountActiveSessions(_ context.Context, filter sessions.ActiveSessionFilter) (int, error) {
	s.lastCountFilter = filter
	return s.countValue, nil
}

func (s *stubSessionStore) CountActiveSessionsByGateway(context.Context, string) ([]sessions.GatewaySessionCount, error) {
	return nil, nil
}

func (s *stubSessionStore) ListSessionConsoleSessions(_ context.Context, filter sessions.SessionConsoleFilter) ([]sessions.SessionConsoleDTO, error) {
	s.lastConsoleFilter = filter
	return s.consoleItems, nil
}

func (s *stubSessionStore) CountSessionConsoleSessions(_ context.Context, filter sessions.SessionConsoleFilter) (int, error) {
	s.lastConsoleFilter = filter
	return s.consoleCount, nil
}

func (s *stubSessionStore) LoadTenantSessionSummary(context.Context, string, string) (*sessions.TenantSessionSummary, error) {
	return s.observeItem, s.observeErr
}

func (s *stubSessionStore) TerminateTenantSession(_ context.Context, _, _, _ string, ipAddress *string) (*sessions.TerminatedSession, error) {
	s.lastIP = ipAddress
	return s.termResult, s.termErr
}

func (s *stubSessionStore) PauseTenantSession(_ context.Context, _, _, _ string, ipAddress *string) (*sessions.SessionControlResult, error) {
	s.lastIP = ipAddress
	return s.pauseResult, s.pauseErr
}

func (s *stubSessionStore) ResumeTenantSession(_ context.Context, _, _, _ string, ipAddress *string) (*sessions.SessionControlResult, error) {
	s.lastIP = ipAddress
	if s.resumeErr != nil {
		return nil, s.resumeErr
	}
	return &sessions.SessionControlResult{ID: "sess-1", Protocol: "SSH", Status: sessions.SessionStatusActive}, nil
}

type stubMembershipResolver struct {
	membership *tenantauth.Membership
	visibility *tenantauth.SessionVisibility
	err        error
}

func (s stubMembershipResolver) ResolveMembership(context.Context, string, string) (*tenantauth.Membership, error) {
	return s.membership, s.err
}

func (s stubMembershipResolver) ResolveSessionVisibility(context.Context, string, string) (*tenantauth.SessionVisibility, error) {
	if s.visibility != nil || s.err != nil {
		return s.visibility, s.err
	}
	if s.membership == nil {
		return nil, nil
	}
	scope := tenantauth.SessionVisibilityScopeOwn
	if s.membership.Permissions[tenantauth.CanViewSessions] {
		scope = tenantauth.SessionVisibilityScopeTenant
	}
	return &tenantauth.SessionVisibility{Membership: s.membership, Scope: scope}, nil
}

type stubObserverGrantIssuer struct {
	response       SSHObserveGrantResponse
	err            error
	called         bool
	lastSessionID  string
	lastObserverID string
}

func (s *stubObserverGrantIssuer) IssueSSHObserverGrant(_ context.Context, sessionID, observerUserID string, _ *http.Request) (SSHObserveGrantResponse, error) {
	s.called = true
	s.lastSessionID = sessionID
	s.lastObserverID = observerUserID
	return s.response, s.err
}

func TestHandlePauseWritesPausedResponse(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{pauseResult: &sessions.SessionControlResult{ID: "sess-1", Protocol: "SSH", Status: sessions.SessionStatusPaused}}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "ADMIN",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanControlSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/pause", nil)
	req.RemoteAddr = "198.51.100.10:1234"
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	err := service.HandlePause(rec, req, authn.Claims{UserID: "admin-1", TenantID: "tenant-1"})
	if err != nil {
		t.Fatalf("HandlePause() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("HandlePause() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `"paused":true`) || !strings.Contains(rec.Body.String(), `"status":"PAUSED"`) {
		t.Fatalf("HandlePause() body = %s", rec.Body.String())
	}
	if store.lastIP == nil || *store.lastIP != "198.51.100.10:1234" {
		t.Fatalf("HandlePause() IP = %#v", store.lastIP)
	}
}

func TestHandleResumeMapsClosedSessionToConflict(t *testing.T) {
	t.Parallel()

	service := Service{
		Store: &stubSessionStore{resumeErr: sessions.ErrSessionClosed},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "ADMIN",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanControlSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/resume", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	if err := service.HandleResume(rec, req, authn.Claims{UserID: "admin-1", TenantID: "tenant-1"}); err != nil {
		t.Fatalf("HandleResume() error = %v", err)
	}
	if rec.Code != http.StatusConflict {
		t.Fatalf("HandleResume() status = %d, want %d", rec.Code, http.StatusConflict)
	}
	if !strings.Contains(rec.Body.String(), "Session already closed") {
		t.Fatalf("HandleResume() body = %s", rec.Body.String())
	}
}

func TestHandleTerminateStillWritesTerminateResponse(t *testing.T) {
	t.Parallel()

	service := Service{
		Store: &stubSessionStore{termResult: &sessions.TerminatedSession{ID: "sess-1", Protocol: "RDP"}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "ADMIN",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanControlSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/terminate", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	if err := service.HandleTerminate(rec, req, authn.Claims{UserID: "admin-1", TenantID: "tenant-1"}); err != nil {
		t.Fatalf("HandleTerminate() error = %v", err)
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("HandleTerminate() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !strings.Contains(rec.Body.String(), `"terminated":true`) {
		t.Fatalf("HandleTerminate() body = %s", rec.Body.String())
	}
}

func TestHandlePauseMapsNotFound(t *testing.T) {
	t.Parallel()

	service := Service{
		Store: &stubSessionStore{pauseErr: sessions.ErrSessionNotFound},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "ADMIN",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanControlSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/pause", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	if err := service.HandlePause(rec, req, authn.Claims{UserID: "admin-1", TenantID: "tenant-1"}); err != nil {
		t.Fatalf("HandlePause() error = %v", err)
	}
	if rec.Code != http.StatusNotFound {
		t.Fatalf("HandlePause() status = %d, want %d", rec.Code, http.StatusNotFound)
	}
	if !strings.Contains(rec.Body.String(), "Session not found") {
		t.Fatalf("HandlePause() body = %s", rec.Body.String())
	}
}

func TestHandlePauseRejectsMembershipError(t *testing.T) {
	t.Parallel()

	service := Service{
		Store:      &stubSessionStore{},
		TenantAuth: stubMembershipResolver{err: errors.New("db offline")},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/pause", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	if err := service.HandlePause(rec, req, authn.Claims{UserID: "admin-1", TenantID: "tenant-1"}); err != nil {
		t.Fatalf("HandlePause() error = %v", err)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("HandlePause() status = %d, want %d", rec.Code, http.StatusServiceUnavailable)
	}
}

func TestHandleListAllowsSplitViewPermissionWithoutLegacyRole(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{listItems: []sessions.ActiveSessionDTO{{ID: "sess-1", Protocol: "SSH"}}}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "MEMBER",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanViewSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions", nil)
	rec := httptest.NewRecorder()

	service.HandleList(rec, req, authn.Claims{UserID: "member-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleList() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !store.listCalled {
		t.Fatalf("HandleList() did not query store")
	}
}

func TestHandleListFallsBackToOwnSessionsWithoutCanViewSessions(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{listItems: []sessions.ActiveSessionDTO{{ID: "sess-1", Protocol: "SSH"}}}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "MEMBER",
			Permissions: map[tenantauth.PermissionFlag]bool{},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/active?protocol=SSH", nil)
	rec := httptest.NewRecorder()

	service.HandleList(rec, req, authn.Claims{UserID: "member-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleList() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if store.lastListFilter.UserID != "member-1" {
		t.Fatalf("HandleList() user filter = %q, want member-1", store.lastListFilter.UserID)
	}
	if store.lastListFilter.Protocol != "SSH" {
		t.Fatalf("HandleList() protocol filter = %q, want SSH", store.lastListFilter.Protocol)
	}
}

func TestHandleCountFallsBackToOwnSessionsWithoutCanViewSessions(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{countValue: 2}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "MEMBER",
			Permissions: map[tenantauth.PermissionFlag]bool{},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/count", nil)
	rec := httptest.NewRecorder()

	service.HandleCount(rec, req, authn.Claims{UserID: "member-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleCount() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if store.lastCountFilter.UserID != "member-1" {
		t.Fatalf("HandleCount() user filter = %q, want member-1", store.lastCountFilter.UserID)
	}
	if !strings.Contains(rec.Body.String(), `"count":2`) {
		t.Fatalf("HandleCount() body = %s", rec.Body.String())
	}
}

func TestBuildStreamSnapshotUsesScopedCountFilter(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{
		listItems:  []sessions.ActiveSessionDTO{{ID: "sess-1", Protocol: "SSH"}},
		countValue: 1,
	}
	service := Service{Store: store}

	filter := sessions.ActiveSessionFilter{TenantID: "tenant-1", UserID: "member-1", Protocol: "SSH"}
	snapshot, err := service.buildStreamSnapshot(context.Background(), filter)
	if err != nil {
		t.Fatalf("buildStreamSnapshot() error = %v", err)
	}
	if snapshot.SessionCount != 1 {
		t.Fatalf("buildStreamSnapshot() session count = %d, want 1", snapshot.SessionCount)
	}
	if store.lastCountFilter.UserID != "member-1" {
		t.Fatalf("buildStreamSnapshot() count user filter = %q, want member-1", store.lastCountFilter.UserID)
	}
}

func TestHandleSessionConsoleReturnsTenantScope(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{
		consoleItems: []sessions.SessionConsoleDTO{{ID: "sess-1", Recording: sessions.SessionConsoleRecordingDTO{Exists: true}}},
		consoleCount: 1,
	}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanViewSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/console", nil)
	rec := httptest.NewRecorder()

	service.HandleSessionConsole(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleSessionConsole() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if store.lastConsoleFilter.UserID != "" {
		t.Fatalf("HandleSessionConsole() user filter = %q, want empty", store.lastConsoleFilter.UserID)
	}
	if !store.lastConsoleFilter.IncludeClosed {
		t.Fatal("HandleSessionConsole() includeClosed = false, want true")
	}
	if !strings.Contains(rec.Body.String(), `"scope":"tenant"`) {
		t.Fatalf("HandleSessionConsole() body = %s", rec.Body.String())
	}
}

func TestHandleSessionConsoleOwnScopeForcesActiveOnly(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{consoleCount: 0}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "MEMBER",
			Permissions: map[tenantauth.PermissionFlag]bool{},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/console?status=CLOSED", nil)
	rec := httptest.NewRecorder()

	service.HandleSessionConsole(rec, req, authn.Claims{UserID: "member-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleSessionConsole() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if store.lastConsoleFilter.UserID != "member-1" {
		t.Fatalf("HandleSessionConsole() user filter = %q, want member-1", store.lastConsoleFilter.UserID)
	}
	if store.lastConsoleFilter.IncludeClosed {
		t.Fatal("HandleSessionConsole() includeClosed = true, want false")
	}
	if len(store.lastConsoleFilter.Statuses) != 0 {
		t.Fatalf("HandleSessionConsole() status filters = %v, want empty", store.lastConsoleFilter.Statuses)
	}
	if !strings.Contains(rec.Body.String(), `"scope":"own"`) {
		t.Fatalf("HandleSessionConsole() body = %s", rec.Body.String())
	}
}

func TestHandleSessionConsoleAcceptsMultipleStatuses(t *testing.T) {
	t.Parallel()

	store := &stubSessionStore{consoleCount: 0}
	service := Service{
		Store: store,
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role:        "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanViewSessions: true},
		}},
	}

	req := httptest.NewRequest(http.MethodGet, "/api/sessions/console?status=ACTIVE,PAUSED", nil)
	rec := httptest.NewRecorder()

	service.HandleSessionConsole(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleSessionConsole() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if got := strings.Join(store.lastConsoleFilter.Statuses, ","); got != "ACTIVE,PAUSED" {
		t.Fatalf("HandleSessionConsole() statuses = %q, want ACTIVE,PAUSED", got)
	}
}

func TestHandleTerminateRejectsViewWithoutControl(t *testing.T) {
	t.Parallel()

	service := Service{
		Store: &stubSessionStore{termResult: &sessions.TerminatedSession{ID: "sess-1", Protocol: "SSH"}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanViewSessions:    true,
				tenantauth.CanObserveSessions: true,
			},
		}},
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/sess-1/terminate", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	if err := service.HandleTerminate(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"}); err != nil {
		t.Fatalf("HandleTerminate() error = %v", err)
	}
	if rec.Code != http.StatusForbidden {
		t.Fatalf("HandleTerminate() status = %d, want %d", rec.Code, http.StatusForbidden)
	}
}

func TestHandleObserveSSHAllowsObservePermissionWithoutControl(t *testing.T) {
	t.Parallel()

	issuer := &stubObserverGrantIssuer{response: SSHObserveGrantResponse{SessionID: "sess-1", Token: "observer-token", ReadOnly: true}}
	service := Service{
		Store: &stubSessionStore{observeItem: &sessions.TenantSessionSummary{ID: "sess-1", UserID: "user-1", Protocol: "SSH", Status: sessions.SessionStatusActive}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanObserveSessions: true,
			},
		}},
		SSHObserverGrants: issuer,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/ssh/sess-1/observe", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	service.HandleObserveSSH(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleObserveSSH() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !issuer.called {
		t.Fatal("HandleObserveSSH() did not issue observer grant")
	}
	if issuer.lastSessionID != "sess-1" || issuer.lastObserverID != "auditor-1" {
		t.Fatalf("unexpected issuer inputs: session=%q observer=%q", issuer.lastSessionID, issuer.lastObserverID)
	}
	if !strings.Contains(rec.Body.String(), `"readOnly":true`) {
		t.Fatalf("HandleObserveSSH() body = %s", rec.Body.String())
	}
}

func TestHandleObserveSSHRejectsNonSSHSessions(t *testing.T) {
	t.Parallel()

	issuer := &stubObserverGrantIssuer{}
	service := Service{
		Store: &stubSessionStore{observeItem: &sessions.TenantSessionSummary{ID: "sess-1", UserID: "user-1", Protocol: "RDP", Status: sessions.SessionStatusActive}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanObserveSessions: true,
			},
		}},
		SSHObserverGrants: issuer,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/ssh/sess-1/observe", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	service.HandleObserveSSH(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("HandleObserveSSH() status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if issuer.called {
		t.Fatal("HandleObserveSSH() issued observer grant for non-SSH session")
	}
	if !strings.Contains(rec.Body.String(), "Only SSH sessions can be observed") {
		t.Fatalf("HandleObserveSSH() body = %s", rec.Body.String())
	}
}
