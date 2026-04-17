package tenantauth

import "testing"

func TestDefaultPermissionsForAuditorSplitSessionAccess(t *testing.T) {
	t.Parallel()

	permissions, ok := DefaultPermissions("AUDITOR")
	if !ok {
		t.Fatalf("DefaultPermissions() ok = false, want true")
	}
	if !permissions[CanViewSessions] {
		t.Fatalf("canViewSessions = false, want true")
	}
	if !permissions[CanObserveSessions] {
		t.Fatalf("canObserveSessions = false, want true")
	}
	if permissions[CanControlSessions] {
		t.Fatalf("canControlSessions = true, want false")
	}
	if legacyManageSessionsValue(permissions) {
		t.Fatalf("legacy manage sessions alias = true, want false")
	}
}

func TestNormalizePermissionOverridesMapsLegacyManageSessions(t *testing.T) {
	t.Parallel()

	defaults, ok := DefaultPermissions("MEMBER")
	if !ok {
		t.Fatalf("DefaultPermissions() ok = false, want true")
	}

	normalized := NormalizePermissionOverrides(map[string]bool{
		string(CanManageSessions): true,
	}, defaults)

	if len(normalized) != 3 {
		t.Fatalf("NormalizePermissionOverrides() len = %d, want 3", len(normalized))
	}
	for _, flag := range sessionPermissionFlags {
		if !normalized[string(flag)] {
			t.Fatalf("NormalizePermissionOverrides() %s = false, want true", flag)
		}
	}
}

func TestNormalizePermissionOverridesPrefersExplicitSplitValues(t *testing.T) {
	t.Parallel()

	defaults, ok := DefaultPermissions("ADMIN")
	if !ok {
		t.Fatalf("DefaultPermissions() ok = false, want true")
	}

	normalized := NormalizePermissionOverrides(map[string]bool{
		string(CanManageSessions):  false,
		string(CanViewSessions):    true,
		string(CanObserveSessions): false,
		string(CanControlSessions): true,
	}, defaults)

	if _, ok := normalized[string(CanViewSessions)]; ok {
		t.Fatalf("NormalizePermissionOverrides() included canViewSessions override when value matched default")
	}
	if value := normalized[string(CanObserveSessions)]; value != false {
		t.Fatalf("NormalizePermissionOverrides() canObserveSessions = %v, want false", value)
	}
	if _, ok := normalized[string(CanControlSessions)]; ok {
		t.Fatalf("NormalizePermissionOverrides() included canControlSessions override when explicit value matched default")
	}
}

func TestOverrideMapForAPIRestoresLegacyManageSessionsAlias(t *testing.T) {
	t.Parallel()

	defaults, ok := DefaultPermissions("AUDITOR")
	if !ok {
		t.Fatalf("DefaultPermissions() ok = false, want true")
	}

	overrides := map[string]bool{string(CanControlSessions): true}
	apiOverrides := OverrideMapForAPI(defaults, overrides)

	if !apiOverrides[string(CanManageSessions)] {
		t.Fatalf("OverrideMapForAPI() canManageSessions = false, want true")
	}
	if !apiOverrides[string(CanControlSessions)] {
		t.Fatalf("OverrideMapForAPI() canControlSessions = false, want true")
	}
}

func TestOverrideMapForAPIPreservesLegacyFalseAliasForAuditorOverride(t *testing.T) {
	t.Parallel()

	defaults, ok := DefaultPermissions("AUDITOR")
	if !ok {
		t.Fatalf("DefaultPermissions() ok = false, want true")
	}

	overrides := map[string]bool{
		string(CanViewSessions):    false,
		string(CanObserveSessions): false,
	}
	apiOverrides := OverrideMapForAPI(defaults, overrides)

	if value := apiOverrides[string(CanManageSessions)]; value {
		t.Fatalf("OverrideMapForAPI() canManageSessions = %v, want false", value)
	}
}

func TestSessionVisibilityFromMembershipFallsBackToOwnScope(t *testing.T) {
	t.Parallel()

	visibility := sessionVisibilityFromMembership(&Membership{
		Role:        "MEMBER",
		Permissions: map[PermissionFlag]bool{CanViewSessions: false},
	})

	if visibility == nil {
		t.Fatal("sessionVisibilityFromMembership() = nil, want visibility")
	}
	if visibility.Scope != SessionVisibilityScopeOwn {
		t.Fatalf("sessionVisibilityFromMembership() scope = %q, want %q", visibility.Scope, SessionVisibilityScopeOwn)
	}
}

func TestSessionVisibilityFromMembershipAllowsTenantScope(t *testing.T) {
	t.Parallel()

	visibility := sessionVisibilityFromMembership(&Membership{
		Role: "AUDITOR",
		Permissions: map[PermissionFlag]bool{
			CanViewSessions:    true,
			CanObserveSessions: true,
		},
	})

	if visibility == nil {
		t.Fatal("sessionVisibilityFromMembership() = nil, want visibility")
	}
	if visibility.Scope != SessionVisibilityScopeTenant {
		t.Fatalf("sessionVisibilityFromMembership() scope = %q, want %q", visibility.Scope, SessionVisibilityScopeTenant)
	}
	if !visibility.CanObserve() {
		t.Fatal("sessionVisibilityFromMembership() canObserve = false, want true")
	}
}
