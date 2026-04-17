package tenantauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type PermissionFlag string

const (
	CanConnect              PermissionFlag = "canConnect"
	CanCreateConnections    PermissionFlag = "canCreateConnections"
	CanManageConnections    PermissionFlag = "canManageConnections"
	CanViewCredentials      PermissionFlag = "canViewCredentials"
	CanShareConnections     PermissionFlag = "canShareConnections"
	CanViewAuditLog         PermissionFlag = "canViewAuditLog"
	CanManageSessions       PermissionFlag = "canManageSessions"
	CanViewSessions         PermissionFlag = "canViewSessions"
	CanObserveSessions      PermissionFlag = "canObserveSessions"
	CanControlSessions      PermissionFlag = "canControlSessions"
	CanManageGateways       PermissionFlag = "canManageGateways"
	CanManageUsers          PermissionFlag = "canManageUsers"
	CanManageSecrets        PermissionFlag = "canManageSecrets"
	CanManageTenantSettings PermissionFlag = "canManageTenantSettings"
)

var roleDefaults = map[string]map[PermissionFlag]bool{
	"OWNER": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanViewSessions: true, CanObserveSessions: true, CanControlSessions: true,
		CanManageGateways: true, CanManageUsers: true,
		CanManageSecrets: true, CanManageTenantSettings: true,
	},
	"ADMIN": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanViewSessions: true, CanObserveSessions: true, CanControlSessions: true,
		CanManageGateways: true, CanManageUsers: true,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"OPERATOR": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanViewSessions: true, CanObserveSessions: true, CanControlSessions: true,
		CanManageGateways: true, CanManageUsers: false,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"MEMBER": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: false, CanShareConnections: true, CanViewAuditLog: false,
		CanViewSessions: false, CanObserveSessions: false, CanControlSessions: false,
		CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"CONSULTANT": {
		CanConnect: true, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: false,
		CanViewSessions: false, CanObserveSessions: false, CanControlSessions: false,
		CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
	"AUDITOR": {
		CanConnect: false, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: true,
		CanViewSessions: true, CanObserveSessions: true, CanControlSessions: false,
		CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
	"GUEST": {
		CanConnect: false, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: false,
		CanViewSessions: false, CanObserveSessions: false, CanControlSessions: false,
		CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
}

var StoredPermissionFlags = []PermissionFlag{
	CanConnect,
	CanCreateConnections,
	CanManageConnections,
	CanViewCredentials,
	CanShareConnections,
	CanViewAuditLog,
	CanViewSessions,
	CanObserveSessions,
	CanControlSessions,
	CanManageGateways,
	CanManageUsers,
	CanManageSecrets,
	CanManageTenantSettings,
}

var AllPermissionFlags = append(append([]PermissionFlag{}, StoredPermissionFlags...), CanManageSessions)

var sessionPermissionFlags = []PermissionFlag{CanViewSessions, CanObserveSessions, CanControlSessions}

func DefaultPermissions(role string) (map[PermissionFlag]bool, bool) {
	defaults, ok := roleDefaults[strings.ToUpper(strings.TrimSpace(role))]
	if !ok {
		return nil, false
	}
	result := make(map[PermissionFlag]bool, len(defaults))
	for flag, value := range defaults {
		result[flag] = value
	}
	return result, true
}

func NormalizePermissionOverrides(overrides map[string]bool, defaults map[PermissionFlag]bool) map[string]bool {
	if overrides == nil {
		return nil
	}

	expanded := expandSessionOverrideAliases(overrides)
	normalized := make(map[string]bool)
	for _, flag := range StoredPermissionFlags {
		key := string(flag)
		value, ok := expanded[key]
		if !ok {
			continue
		}
		if value != defaults[flag] {
			normalized[key] = value
		}
	}
	if len(normalized) == 0 {
		return nil
	}
	return normalized
}

func EffectivePermissions(role string, overrides map[string]bool) (map[PermissionFlag]bool, bool) {
	permissions, ok := DefaultPermissions(role)
	if !ok {
		return nil, false
	}
	for key, value := range NormalizePermissionOverrides(overrides, permissions) {
		permissions[PermissionFlag(key)] = value
	}
	return permissions, true
}

func PermissionMapForAPI(permissions map[PermissionFlag]bool) map[string]bool {
	result := make(map[string]bool, len(AllPermissionFlags))
	for _, flag := range AllPermissionFlags {
		result[string(flag)] = false
	}
	for _, flag := range StoredPermissionFlags {
		result[string(flag)] = permissions[flag]
	}
	result[string(CanManageSessions)] = legacyManageSessionsValue(permissions)
	return result
}

func OverrideMapForAPI(defaults map[PermissionFlag]bool, overrides map[string]bool) map[string]bool {
	if overrides == nil {
		return nil
	}

	result := make(map[string]bool, len(overrides)+1)
	for key, value := range overrides {
		result[key] = value
	}
	if hasSessionOverride(overrides) {
		permissions := make(map[PermissionFlag]bool, len(defaults))
		for flag, value := range defaults {
			permissions[flag] = value
		}
		for key, value := range overrides {
			permissions[PermissionFlag(key)] = value
		}
		result[string(CanManageSessions)] = legacyManageSessionsValue(permissions)
	}
	return result
}

func DecodePermissionOverrides(raw string) (map[string]bool, error) {
	var overrides map[string]bool
	if err := json.Unmarshal([]byte(raw), &overrides); err != nil {
		return nil, err
	}
	return overrides, nil
}

func expandSessionOverrideAliases(overrides map[string]bool) map[string]bool {
	if overrides == nil {
		return nil
	}

	expanded := make(map[string]bool, len(overrides)+len(sessionPermissionFlags))
	for key, value := range overrides {
		expanded[key] = value
	}
	legacyValue, hasLegacy := overrides[string(CanManageSessions)]
	if !hasLegacy {
		return expanded
	}
	for _, flag := range sessionPermissionFlags {
		key := string(flag)
		if _, ok := expanded[key]; !ok {
			expanded[key] = legacyValue
		}
	}
	return expanded
}

func hasSessionOverride(overrides map[string]bool) bool {
	for _, flag := range sessionPermissionFlags {
		if _, ok := overrides[string(flag)]; ok {
			return true
		}
	}
	return false
}

func legacyManageSessionsValue(permissions map[PermissionFlag]bool) bool {
	return permissions[CanViewSessions] && permissions[CanObserveSessions] && permissions[CanControlSessions]
}

type Membership struct {
	Role        string
	Permissions map[PermissionFlag]bool
}

type Service struct {
	DB *pgxpool.Pool
}

func (s Service) ResolveMembership(ctx context.Context, userID, tenantID string) (*Membership, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}

	var (
		roleText      string
		overridesText *string
		isActive      bool
		statusText    string
		expiresAt     *time.Time
		userEnabled   bool
	)
	err := s.DB.QueryRow(
		ctx,
		`SELECT tm.role::text,
		        CASE
		          WHEN tm."permissionOverrides" IS NULL OR tm."permissionOverrides" = 'null'::jsonb THEN NULL
		          ELSE tm."permissionOverrides"::text
		        END,
		        tm."isActive",
		        tm.status::text,
		        tm."expiresAt",
		        u.enabled
		   FROM "TenantMember" tm
		   JOIN "User" u ON u.id = tm."userId"
		  WHERE tm."userId" = $1
		    AND tm."tenantId" = $2`,
		userID,
		tenantID,
	).Scan(&roleText, &overridesText, &isActive, &statusText, &expiresAt, &userEnabled)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load tenant membership: %w", err)
	}

	if !userEnabled || !isActive || statusText != "ACCEPTED" {
		return nil, nil
	}
	if expiresAt != nil && !expiresAt.After(time.Now()) {
		return nil, nil
	}

	permissions, ok := DefaultPermissions(roleText)
	if !ok {
		return nil, nil
	}

	if overridesText != nil && *overridesText != "" {
		overrides, err := DecodePermissionOverrides(*overridesText)
		if err != nil {
			return nil, fmt.Errorf("decode permission overrides: %w", err)
		}
		for key, value := range NormalizePermissionOverrides(overrides, permissions) {
			permissions[PermissionFlag(key)] = value
		}
	}

	return &Membership{
		Role:        roleText,
		Permissions: permissions,
	}, nil
}
