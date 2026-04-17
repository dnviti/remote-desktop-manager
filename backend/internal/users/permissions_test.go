package users

import (
	"context"
	"testing"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

func TestGetCurrentPermissionsReturnsEmptyWithoutTenant(t *testing.T) {
	t.Parallel()

	result, err := (Service{}).GetCurrentPermissions(context.Background(), authn.Claims{
		UserID: "user-1",
	})
	if err != nil {
		t.Fatalf("GetCurrentPermissions() error = %v", err)
	}
	if result.TenantID != "" {
		t.Fatalf("TenantID = %q, want empty", result.TenantID)
	}
	for _, flag := range tenantauth.AllPermissionFlags {
		if result.Permissions[string(flag)] {
			t.Fatalf("permission %s = true, want false", flag)
		}
	}
}

func TestGetCurrentPermissionsFallsBackToTenantRoleDefaults(t *testing.T) {
	t.Parallel()

	result, err := (Service{}).GetCurrentPermissions(context.Background(), authn.Claims{
		UserID:     "user-1",
		TenantID:   "tenant-1",
		TenantRole: "OPERATOR",
	})
	if err != nil {
		t.Fatalf("GetCurrentPermissions() error = %v", err)
	}
	if result.TenantID != "tenant-1" {
		t.Fatalf("TenantID = %q, want tenant-1", result.TenantID)
	}
	if result.Role != "OPERATOR" {
		t.Fatalf("Role = %q, want OPERATOR", result.Role)
	}
	if !result.Permissions[string(tenantauth.CanManageGateways)] {
		t.Fatalf("canManageGateways = false, want true")
	}
	if !result.Permissions[string(tenantauth.CanViewSessions)] {
		t.Fatalf("canViewSessions = false, want true")
	}
	if !result.Permissions[string(tenantauth.CanObserveSessions)] {
		t.Fatalf("canObserveSessions = false, want true")
	}
	if !result.Permissions[string(tenantauth.CanControlSessions)] {
		t.Fatalf("canControlSessions = false, want true")
	}
	if !result.Permissions[string(tenantauth.CanManageSessions)] {
		t.Fatalf("canManageSessions = false, want true")
	}
	if result.Permissions[string(tenantauth.CanManageUsers)] {
		t.Fatalf("canManageUsers = true, want false")
	}
}

func TestGetCurrentPermissionsReturnsLegacySessionAliasFromSplitDefaults(t *testing.T) {
	t.Parallel()

	result, err := (Service{}).GetCurrentPermissions(context.Background(), authn.Claims{
		UserID:     "user-1",
		TenantID:   "tenant-1",
		TenantRole: "AUDITOR",
	})
	if err != nil {
		t.Fatalf("GetCurrentPermissions() error = %v", err)
	}
	if !result.Permissions[string(tenantauth.CanViewSessions)] {
		t.Fatalf("canViewSessions = false, want true")
	}
	if !result.Permissions[string(tenantauth.CanObserveSessions)] {
		t.Fatalf("canObserveSessions = false, want true")
	}
	if result.Permissions[string(tenantauth.CanControlSessions)] {
		t.Fatalf("canControlSessions = true, want false")
	}
	if result.Permissions[string(tenantauth.CanManageSessions)] {
		t.Fatalf("canManageSessions = true, want false")
	}
}
