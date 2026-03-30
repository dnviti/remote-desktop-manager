package tenants

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5"
)

func (s Service) GetUserPermissions(ctx context.Context, tenantID, targetUserID string) (tenantUserPermissionsResponse, error) {
	if s.DB == nil {
		return tenantUserPermissionsResponse{}, fmt.Errorf("database is unavailable")
	}

	var (
		roleText      string
		overridesText *string
	)
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text,
		        CASE
		          WHEN "permissionOverrides" IS NULL OR "permissionOverrides" = 'null'::jsonb THEN NULL
		          ELSE "permissionOverrides"::text
		        END
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&roleText, &overridesText); err != nil {
		return tenantUserPermissionsResponse{}, err
	}

	defaults, ok := tenantauth.DefaultPermissions(roleText)
	if !ok {
		return tenantUserPermissionsResponse{}, &requestError{status: 400, message: "Unknown tenant role"}
	}

	result := tenantUserPermissionsResponse{
		Role:        roleText,
		Permissions: make(map[string]bool, len(defaults)),
		Defaults:    make(map[string]bool, len(defaults)),
	}
	for flag, value := range defaults {
		result.Permissions[string(flag)] = value
		result.Defaults[string(flag)] = value
	}

	if overridesText != nil && strings.TrimSpace(*overridesText) != "" {
		var overrides map[string]bool
		if err := json.Unmarshal([]byte(*overridesText), &overrides); err != nil {
			return tenantUserPermissionsResponse{}, fmt.Errorf("decode permission overrides: %w", err)
		}
		if len(overrides) > 0 {
			result.Overrides = make(map[string]bool, len(overrides))
			for key, value := range overrides {
				result.Overrides[key] = value
				result.Permissions[key] = value
			}
		}
	}
	if result.Overrides == nil {
		result.Overrides = nil
	}
	return result, nil
}

func (s Service) UpdateUserPermissions(ctx context.Context, tenantID, targetUserID string, overrides map[string]bool) (tenantUserPermissionsResponse, error) {
	if s.DB == nil {
		return tenantUserPermissionsResponse{}, fmt.Errorf("database is unavailable")
	}

	var roleText string
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&roleText); err != nil {
		return tenantUserPermissionsResponse{}, err
	}

	defaults, ok := tenantauth.DefaultPermissions(roleText)
	if !ok {
		return tenantUserPermissionsResponse{}, &requestError{status: 400, message: "Unknown tenant role"}
	}

	if strings.EqualFold(strings.TrimSpace(roleText), "OWNER") && overrides != nil {
		for key, value := range overrides {
			flag := tenantauth.PermissionFlag(key)
			if defaults[flag] && !value {
				return tenantUserPermissionsResponse{}, &requestError{status: 400, message: "Cannot reduce permissions for an OWNER"}
			}
		}
	}

	var normalized map[string]bool
	if overrides != nil {
		normalized = make(map[string]bool)
		for _, flag := range tenantauth.AllPermissionFlags {
			key := string(flag)
			value, exists := overrides[key]
			if !exists {
				continue
			}
			if value != defaults[flag] {
				normalized[key] = value
			}
		}
		if len(normalized) == 0 {
			normalized = nil
		}
	}

	var storedValue any
	if normalized != nil {
		raw, err := json.Marshal(normalized)
		if err != nil {
			return tenantUserPermissionsResponse{}, fmt.Errorf("marshal permission overrides: %w", err)
		}
		storedValue = string(raw)
	}

	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "TenantMember"
		    SET "permissionOverrides" = $3::jsonb,
		        "updatedAt" = NOW()
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
		storedValue,
	); err != nil {
		return tenantUserPermissionsResponse{}, fmt.Errorf("update permission overrides: %w", err)
	}

	return s.GetUserPermissions(ctx, tenantID, targetUserID)
}

func (s Service) UpdateUserRole(ctx context.Context, tenantID, targetUserID, newRole, actingUserID string) (tenantManagedUserResponse, error) {
	roleText, err := normalizeTenantRole(newRole)
	if err != nil {
		return tenantManagedUserResponse{}, err
	}

	var currentRole string
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&currentRole); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantManagedUserResponse{}, &requestError{status: 404, message: "User not found in this organization"}
		}
		return tenantManagedUserResponse{}, fmt.Errorf("load tenant membership: %w", err)
	}

	if strings.EqualFold(currentRole, "OWNER") && !strings.EqualFold(roleText, "OWNER") {
		var ownerCount int
		if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "TenantMember" WHERE "tenantId" = $1 AND role = 'OWNER'`, tenantID).Scan(&ownerCount); err != nil {
			return tenantManagedUserResponse{}, fmt.Errorf("count tenant owners: %w", err)
		}
		if ownerCount <= 1 {
			return tenantManagedUserResponse{}, &requestError{status: 400, message: "Cannot change role of the last owner. Transfer ownership first."}
		}
	}
	if targetUserID == actingUserID && strings.EqualFold(currentRole, "OWNER") && !strings.EqualFold(roleText, "OWNER") {
		var ownerCount int
		if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "TenantMember" WHERE "tenantId" = $1 AND role = 'OWNER'`, tenantID).Scan(&ownerCount); err != nil {
			return tenantManagedUserResponse{}, fmt.Errorf("count tenant owners: %w", err)
		}
		if ownerCount <= 1 {
			return tenantManagedUserResponse{}, &requestError{status: 400, message: "Cannot demote yourself as the last owner"}
		}
	}

	var (
		result tenantManagedUserResponse
		name   sql.NullString
	)
	if err := s.DB.QueryRow(
		ctx,
		`UPDATE "TenantMember" tm
		    SET role = $3::"TenantRole",
		        "updatedAt" = NOW()
		   FROM "User" u
		  WHERE tm."tenantId" = $1
		    AND tm."userId" = $2
		    AND u.id = tm."userId"
		RETURNING u.id, u.email, u.username, tm.role::text`,
		tenantID,
		targetUserID,
		roleText,
	).Scan(&result.ID, &result.Email, &name, &result.Role); err != nil {
		return tenantManagedUserResponse{}, fmt.Errorf("update tenant role: %w", err)
	}
	if name.Valid {
		result.Username = &name.String
	}
	return result, nil
}

func (s Service) RemoveUser(ctx context.Context, tenantID, targetUserID, actingUserID string) (map[string]bool, error) {
	var roleText string
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&roleText); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{status: 404, message: "User not found in this organization"}
		}
		return nil, fmt.Errorf("load tenant membership: %w", err)
	}
	if targetUserID == actingUserID {
		return nil, &requestError{status: 400, message: "Cannot remove yourself. Use leave organization instead."}
	}
	if strings.EqualFold(roleText, "OWNER") {
		var ownerCount int
		if err := s.DB.QueryRow(ctx, `SELECT COUNT(*)::int FROM "TenantMember" WHERE "tenantId" = $1 AND role = 'OWNER'`, tenantID).Scan(&ownerCount); err != nil {
			return nil, fmt.Errorf("count tenant owners: %w", err)
		}
		if ownerCount <= 1 {
			return nil, &requestError{status: 400, message: "Cannot remove the last owner"}
		}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tenant user removal: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(
		ctx,
		`DELETE FROM "TeamMember"
		  WHERE "userId" = $1
		    AND "teamId" IN (SELECT id FROM "Team" WHERE "tenantId" = $2)`,
		targetUserID,
		tenantID,
	); err != nil {
		return nil, fmt.Errorf("delete tenant team memberships: %w", err)
	}
	if _, err := tx.Exec(
		ctx,
		`DELETE FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	); err != nil {
		return nil, fmt.Errorf("delete tenant membership: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tenant user removal: %w", err)
	}
	return map[string]bool{"removed": true}, nil
}

func (s Service) ToggleUserEnabled(ctx context.Context, tenantID, targetUserID string, enabled bool, actingUserID string) (tenantManagedUserResponse, error) {
	var roleText string
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&roleText); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantManagedUserResponse{}, &requestError{status: 404, message: "User not found in this organization"}
		}
		return tenantManagedUserResponse{}, fmt.Errorf("load tenant membership: %w", err)
	}
	if targetUserID == actingUserID && !enabled {
		return tenantManagedUserResponse{}, &requestError{status: 400, message: "Cannot disable your own account"}
	}
	if !enabled && strings.EqualFold(roleText, "OWNER") {
		var enabledOwners int
		if err := s.DB.QueryRow(
			ctx,
			`SELECT COUNT(*)::int
			   FROM "TenantMember" tm
			   JOIN "User" u ON u.id = tm."userId"
			  WHERE tm."tenantId" = $1
			    AND tm.role = 'OWNER'
			    AND u.enabled = true`,
			tenantID,
		).Scan(&enabledOwners); err != nil {
			return tenantManagedUserResponse{}, fmt.Errorf("count active tenant owners: %w", err)
		}
		if enabledOwners <= 1 {
			return tenantManagedUserResponse{}, &requestError{status: 400, message: "Cannot disable the last active owner"}
		}
	}

	var (
		result tenantManagedUserResponse
		name   sql.NullString
	)
	if err := s.DB.QueryRow(
		ctx,
		`UPDATE "User" u
		    SET enabled = $2,
		        "updatedAt" = NOW()
		   FROM "TenantMember" tm
		  WHERE tm."tenantId" = $1
		    AND tm."userId" = $3
		    AND u.id = tm."userId"
		RETURNING u.id, u.email, u.username, u.enabled, tm.role::text`,
		tenantID,
		enabled,
		targetUserID,
	).Scan(&result.ID, &result.Email, &name, &result.Enabled, &result.Role); err != nil {
		return tenantManagedUserResponse{}, fmt.Errorf("toggle tenant user enabled: %w", err)
	}
	if name.Valid {
		result.Username = &name.String
	}

	if !enabled {
		if _, err := s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "userId" = $1`, targetUserID); err != nil {
			return tenantManagedUserResponse{}, fmt.Errorf("delete refresh tokens: %w", err)
		}
	}
	return result, nil
}

func (s Service) UpdateMembershipExpiry(ctx context.Context, tenantID, targetUserID string, expiresAt *time.Time) (map[string]any, error) {
	var roleText string
	if err := s.DB.QueryRow(
		ctx,
		`SELECT role::text
		   FROM "TenantMember"
		  WHERE "tenantId" = $1
		    AND "userId" = $2`,
		tenantID,
		targetUserID,
	).Scan(&roleText); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{status: 404, message: "User not found in this organization"}
		}
		return nil, fmt.Errorf("load tenant membership: %w", err)
	}
	if strings.EqualFold(roleText, "OWNER") {
		return nil, &requestError{status: 400, message: "Cannot set expiration on owner membership"}
	}

	var updated sql.NullTime
	if err := s.DB.QueryRow(
		ctx,
		`UPDATE "TenantMember"
		    SET "expiresAt" = $3,
		        "updatedAt" = NOW()
		  WHERE "tenantId" = $1
		    AND "userId" = $2
		RETURNING "expiresAt"`,
		tenantID,
		targetUserID,
		expiresAt,
	).Scan(&updated); err != nil {
		return nil, fmt.Errorf("update membership expiry: %w", err)
	}

	result := map[string]any{
		"userId": targetUserID,
	}
	if updated.Valid {
		result["expiresAt"] = updated.Time.UTC().Format(time.RFC3339)
	} else {
		result["expiresAt"] = nil
	}
	return result, nil
}
