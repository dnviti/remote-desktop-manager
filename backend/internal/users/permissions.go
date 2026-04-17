package users

import (
	"context"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

func emptyPermissions() map[string]bool {
	return tenantauth.PermissionMapForAPI(nil)
}

func (s Service) GetCurrentPermissions(ctx context.Context, claims authn.Claims) (currentPermissionsResponse, error) {
	response := currentPermissionsResponse{
		TenantID:    strings.TrimSpace(claims.TenantID),
		Role:        strings.TrimSpace(claims.TenantRole),
		Permissions: emptyPermissions(),
	}
	if response.TenantID == "" {
		return response, nil
	}

	if s.TenantAuth.DB == nil {
		defaults, ok := tenantauth.DefaultPermissions(response.Role)
		if !ok {
			return response, nil
		}
		response.Permissions = tenantauth.PermissionMapForAPI(defaults)
		return response, nil
	}

	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, response.TenantID)
	if err != nil {
		return currentPermissionsResponse{}, err
	}
	if membership == nil {
		return response, nil
	}

	response.Role = membership.Role
	response.Permissions = tenantauth.PermissionMapForAPI(membership.Permissions)
	return response, nil
}
