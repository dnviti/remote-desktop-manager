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
	CanManageGateways       PermissionFlag = "canManageGateways"
	CanManageUsers          PermissionFlag = "canManageUsers"
	CanManageSecrets        PermissionFlag = "canManageSecrets"
	CanManageTenantSettings PermissionFlag = "canManageTenantSettings"
)

var roleDefaults = map[string]map[PermissionFlag]bool{
	"OWNER": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanManageSessions: true, CanManageGateways: true, CanManageUsers: true,
		CanManageSecrets: true, CanManageTenantSettings: true,
	},
	"ADMIN": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanManageSessions: true, CanManageGateways: true, CanManageUsers: true,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"OPERATOR": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: true, CanShareConnections: true, CanViewAuditLog: true,
		CanManageSessions: true, CanManageGateways: true, CanManageUsers: false,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"MEMBER": {
		CanConnect: true, CanCreateConnections: true, CanManageConnections: true,
		CanViewCredentials: false, CanShareConnections: true, CanViewAuditLog: false,
		CanManageSessions: false, CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: true, CanManageTenantSettings: false,
	},
	"CONSULTANT": {
		CanConnect: true, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: false,
		CanManageSessions: false, CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
	"AUDITOR": {
		CanConnect: false, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: true,
		CanManageSessions: true, CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
	"GUEST": {
		CanConnect: false, CanCreateConnections: false, CanManageConnections: false,
		CanViewCredentials: false, CanShareConnections: false, CanViewAuditLog: false,
		CanManageSessions: false, CanManageGateways: false, CanManageUsers: false,
		CanManageSecrets: false, CanManageTenantSettings: false,
	},
}

var AllPermissionFlags = []PermissionFlag{
	CanConnect,
	CanCreateConnections,
	CanManageConnections,
	CanViewCredentials,
	CanShareConnections,
	CanViewAuditLog,
	CanManageSessions,
	CanManageGateways,
	CanManageUsers,
	CanManageSecrets,
	CanManageTenantSettings,
}

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

	defaults, ok := roleDefaults[roleText]
	if !ok {
		return nil, nil
	}
	permissions := make(map[PermissionFlag]bool, len(defaults))
	for flag, value := range defaults {
		permissions[flag] = value
	}

	if overridesText != nil && *overridesText != "" {
		var overrides map[string]bool
		if err := json.Unmarshal([]byte(*overridesText), &overrides); err != nil {
			return nil, fmt.Errorf("decode permission overrides: %w", err)
		}
		for key, value := range overrides {
			flag := PermissionFlag(key)
			if _, known := defaults[flag]; known {
				permissions[flag] = value
			}
		}
	}

	return &Membership{
		Role:        roleText,
		Permissions: permissions,
	}, nil
}
