package auditapi

import (
	"context"
	"errors"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type stubTenantAuth struct {
	visibility *tenantauth.SessionVisibility
	err        error
}

func (s stubTenantAuth) ResolveMembership(context.Context, string, string) (*tenantauth.Membership, error) {
	return nil, s.err
}

func (s stubTenantAuth) ResolveSessionVisibility(context.Context, string, string) (*tenantauth.SessionVisibility, error) {
	return s.visibility, s.err
}

func TestResolveSessionRecordingAccessFallsBackToOwnWithoutTenant(t *testing.T) {
	t.Parallel()

	access, err := (Service{}).resolveSessionRecordingAccess(context.Background(), authn.Claims{UserID: "user-1"})
	if err != nil {
		t.Fatalf("resolveSessionRecordingAccess() error = %v", err)
	}
	if access.UserID != "user-1" || access.TenantID != "" {
		t.Fatalf("resolveSessionRecordingAccess() = %#v", access)
	}
}

func TestResolveSessionRecordingAccessRejectsMissingTenantMembership(t *testing.T) {
	t.Parallel()

	_, err := (Service{TenantAuth: stubTenantAuth{}}).resolveSessionRecordingAccess(context.Background(), authn.Claims{UserID: "user-1", TenantID: "tenant-1"})
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("resolveSessionRecordingAccess() error = %v, want requestError", err)
	}
	if reqErr.status != 403 {
		t.Fatalf("resolveSessionRecordingAccess() status = %d, want 403", reqErr.status)
	}
}

func TestSessionRecordingAccessClausesUseTenantScopeWithoutOwnerFilter(t *testing.T) {
	t.Parallel()

	access := sessionRecordingAccess{
		UserID:   "user-1",
		TenantID: "tenant-1",
		Visibility: &tenantauth.SessionVisibility{
			Scope: tenantauth.SessionVisibilityScopeTenant,
		},
	}
	args := make([]any, 0, 2)
	clauses := access.clauses(&args, "r", "sess")
	if len(clauses) != 1 {
		t.Fatalf("clauses len = %d, want 1", len(clauses))
	}
}

func TestSessionRecordingAccessClausesUseOwnerFilterForOwnScope(t *testing.T) {
	t.Parallel()

	access := sessionRecordingAccess{
		UserID:   "user-1",
		TenantID: "tenant-1",
		Visibility: &tenantauth.SessionVisibility{
			Scope: tenantauth.SessionVisibilityScopeOwn,
		},
	}
	args := make([]any, 0, 2)
	clauses := access.clauses(&args, "r", "sess")
	if len(clauses) != 2 {
		t.Fatalf("clauses len = %d, want 2", len(clauses))
	}
}
