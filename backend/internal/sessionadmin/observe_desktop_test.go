package sessionadmin

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type stubDesktopObserverGrantIssuer struct {
	response       DesktopObserveGrantResponse
	err            error
	called         bool
	lastTarget     sessions.TenantSessionSummary
	lastObserverID string
}

func (s *stubDesktopObserverGrantIssuer) IssueDesktopObserverGrant(_ context.Context, target sessions.TenantSessionSummary, observerUserID string, _ *http.Request) (DesktopObserveGrantResponse, error) {
	s.called = true
	s.lastTarget = target
	s.lastObserverID = observerUserID
	return s.response, s.err
}

func TestHandleObserveRDPAllowsObservePermissionWithoutControl(t *testing.T) {
	t.Parallel()

	issuer := &stubDesktopObserverGrantIssuer{response: DesktopObserveGrantResponse{SessionID: "sess-1", Protocol: "RDP", Token: "observer-token", ReadOnly: true}}
	service := Service{
		Store: &stubSessionStore{observeItem: &sessions.TenantSessionSummary{ID: "sess-1", UserID: "user-1", ConnectionID: "conn-1", Protocol: "RDP", Status: sessions.SessionStatusActive, GatewayID: "gw-1", GuacdConnectionID: "owner-conn-1"}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanObserveSessions: true,
			},
		}},
		DesktopObserverGrants: issuer,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/rdp/sess-1/observe", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	service.HandleObserveRDP(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleObserveRDP() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if !issuer.called {
		t.Fatal("HandleObserveRDP() did not issue desktop observer grant")
	}
	if issuer.lastTarget.ID != "sess-1" || issuer.lastTarget.GuacdConnectionID != "owner-conn-1" {
		t.Fatalf("unexpected target passed to issuer: %#v", issuer.lastTarget)
	}
	if issuer.lastObserverID != "auditor-1" {
		t.Fatalf("unexpected observer id %q", issuer.lastObserverID)
	}
	if !strings.Contains(rec.Body.String(), `"readOnly":true`) {
		t.Fatalf("HandleObserveRDP() body = %s", rec.Body.String())
	}
}

func TestHandleObserveRDPRejectsDesktopSessionWithoutReadyConnectionID(t *testing.T) {
	t.Parallel()

	issuer := &stubDesktopObserverGrantIssuer{}
	service := Service{
		Store: &stubSessionStore{observeItem: &sessions.TenantSessionSummary{ID: "sess-1", UserID: "user-1", ConnectionID: "conn-1", Protocol: "RDP", Status: sessions.SessionStatusActive, GatewayID: "gw-1"}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanObserveSessions: true,
			},
		}},
		DesktopObserverGrants: issuer,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/rdp/sess-1/observe", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	service.HandleObserveRDP(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusConflict {
		t.Fatalf("HandleObserveRDP() status = %d, want %d", rec.Code, http.StatusConflict)
	}
	if issuer.called {
		t.Fatal("HandleObserveRDP() issued observer grant without ready connection id")
	}
	if !strings.Contains(rec.Body.String(), "Desktop session is not ready for observation yet") {
		t.Fatalf("HandleObserveRDP() body = %s", rec.Body.String())
	}
}

func TestHandleObserveVNCRejectsNonVNCSessions(t *testing.T) {
	t.Parallel()

	issuer := &stubDesktopObserverGrantIssuer{}
	service := Service{
		Store: &stubSessionStore{observeItem: &sessions.TenantSessionSummary{ID: "sess-1", UserID: "user-1", ConnectionID: "conn-1", Protocol: "RDP", Status: sessions.SessionStatusActive, GuacdConnectionID: "owner-conn-1"}},
		TenantAuth: stubMembershipResolver{membership: &tenantauth.Membership{
			Role: "AUDITOR",
			Permissions: map[tenantauth.PermissionFlag]bool{
				tenantauth.CanObserveSessions: true,
			},
		}},
		DesktopObserverGrants: issuer,
	}

	req := httptest.NewRequest(http.MethodPost, "/api/sessions/vnc/sess-1/observe", nil)
	req.SetPathValue("sessionId", "sess-1")
	rec := httptest.NewRecorder()

	service.HandleObserveVNC(rec, req, authn.Claims{UserID: "auditor-1", TenantID: "tenant-1"})

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("HandleObserveVNC() status = %d, want %d", rec.Code, http.StatusBadRequest)
	}
	if issuer.called {
		t.Fatal("HandleObserveVNC() issued observer grant for non-VNC session")
	}
	if !strings.Contains(rec.Body.String(), "Only VNC sessions can be observed") {
		t.Fatalf("HandleObserveVNC() body = %s", rec.Body.String())
	}
}
