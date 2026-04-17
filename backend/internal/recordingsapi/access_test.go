package recordingsapi

import (
	"context"
	"errors"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type stubVisibilityResolver struct {
	visibility *tenantauth.SessionVisibility
	err        error
}

func (s stubVisibilityResolver) ResolveSessionVisibility(context.Context, string, string) (*tenantauth.SessionVisibility, error) {
	return s.visibility, s.err
}

func TestResolveRecordingVisibilityFallsBackToOwnWithoutTenant(t *testing.T) {
	t.Parallel()

	access, err := (Service{}).resolveRecordingVisibility(context.Background(), authn.Claims{UserID: "user-1"})
	if err != nil {
		t.Fatalf("resolveRecordingVisibility() error = %v", err)
	}
	if access.UserID != "user-1" || access.TenantID != "" {
		t.Fatalf("resolveRecordingVisibility() = %#v", access)
	}
}

func TestResolveRecordingVisibilityRejectsMissingTenantMembership(t *testing.T) {
	t.Parallel()

	_, err := (Service{TenantAuth: stubVisibilityResolver{}}).resolveRecordingVisibility(context.Background(), authn.Claims{UserID: "user-1", TenantID: "tenant-1"})
	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("resolveRecordingVisibility() error = %v, want requestError", err)
	}
	if reqErr.status != 403 {
		t.Fatalf("resolveRecordingVisibility() status = %d, want 403", reqErr.status)
	}
}

func TestRecordingVisibilityClausesUseTenantScopeWithoutOwnerFilter(t *testing.T) {
	t.Parallel()

	access := recordingVisibility{
		UserID:   "user-1",
		TenantID: "tenant-1",
		Visibility: &tenantauth.SessionVisibility{
			Scope:      tenantauth.SessionVisibilityScopeTenant,
			Membership: &tenantauth.Membership{Permissions: map[tenantauth.PermissionFlag]bool{tenantauth.CanControlSessions: true}},
		},
	}
	args := make([]any, 0, 2)
	clauses := access.clauses(&args, "sr", "sess")

	if len(clauses) != 1 {
		t.Fatalf("clauses len = %d, want 1", len(clauses))
	}
	if access.canDelete() != true {
		t.Fatal("canDelete() = false, want true")
	}
}

func TestRecordingVisibilityClausesUseOwnerFilterForOwnScope(t *testing.T) {
	t.Parallel()

	access := recordingVisibility{
		UserID:   "user-1",
		TenantID: "tenant-1",
		Visibility: &tenantauth.SessionVisibility{
			Scope: tenantauth.SessionVisibilityScopeOwn,
		},
	}
	args := make([]any, 0, 2)
	clauses := access.clauses(&args, "sr", "sess")

	if len(clauses) != 2 {
		t.Fatalf("clauses len = %d, want 2", len(clauses))
	}
	if !access.canDelete() {
		t.Fatal("canDelete() = false, want true")
	}
}
