package tenants

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
)

func (s Service) GetTenant(ctx context.Context, tenantID string) (tenantResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	t.id,
	t.name,
	t.slug,
	t."mfaRequired",
	t."vaultAutoLockMaxMinutes",
	(
		SELECT COUNT(*)::int
		FROM "TenantMember" tm
		WHERE tm."tenantId" = t.id
		  AND tm.status = 'ACCEPTED'
	) AS "userCount",
	t."defaultSessionTimeoutSeconds",
	t."maxConcurrentSessions",
	t."absoluteSessionTimeoutSeconds",
	t."dlpDisableCopy",
	t."dlpDisablePaste",
	t."dlpDisableDownload",
	t."dlpDisableUpload",
	t."enforcedConnectionSettings",
	t."tunnelDefaultEnabled",
	t."tunnelAutoTokenRotation",
	t."tunnelTokenRotationDays",
	t."tunnelRequireForRemote",
	t."tunnelTokenMaxLifetimeDays",
	t."tunnelAgentAllowedCidrs",
	t."loginRateLimitWindowMs",
	t."loginRateLimitMaxAttempts",
	t."accountLockoutThreshold",
	t."accountLockoutDurationMs",
	t."impossibleTravelSpeedKmh",
	t."jwtExpiresInSeconds",
	t."jwtRefreshExpiresInSeconds",
	t."vaultDefaultTtlMinutes",
	t."recordingEnabled",
	t."recordingRetentionDays",
	t."fileUploadMaxSizeBytes",
	t."userDriveQuotaBytes",
	(
		SELECT COUNT(*)::int
		FROM "Team" team
		WHERE team."tenantId" = t.id
	) AS "teamCount",
	t."createdAt",
	t."updatedAt"
FROM "Tenant" t
WHERE t.id = $1
`, tenantID)

	var (
		result                     tenantResponse
		vaultAutoLock              sql.NullInt32
		tunnelTokenMaxLifetime     sql.NullInt32
		loginRateLimitWindow       sql.NullInt32
		loginRateLimitMaxAttempts  sql.NullInt32
		accountLockoutThreshold    sql.NullInt32
		accountLockoutDuration     sql.NullInt32
		impossibleTravelSpeed      sql.NullInt32
		jwtExpires                 sql.NullInt32
		jwtRefreshExpires          sql.NullInt32
		vaultDefaultTTL            sql.NullInt32
		recordingRetentionDays     sql.NullInt32
		fileUploadMaxSizeBytes     sql.NullInt32
		userDriveQuotaBytes        sql.NullInt32
		enforcedConnectionSettings []byte
		tunnelAgentAllowedCIDRs    []string
	)

	if err := row.Scan(
		&result.ID,
		&result.Name,
		&result.Slug,
		&result.MFARequired,
		&vaultAutoLock,
		&result.UserCount,
		&result.DefaultSessionTimeoutSeconds,
		&result.MaxConcurrentSessions,
		&result.AbsoluteSessionTimeoutSeconds,
		&result.DLPDisableCopy,
		&result.DLPDisablePaste,
		&result.DLPDisableDownload,
		&result.DLPDisableUpload,
		&enforcedConnectionSettings,
		&result.TunnelDefaultEnabled,
		&result.TunnelAutoTokenRotation,
		&result.TunnelTokenRotationDays,
		&result.TunnelRequireForRemote,
		&tunnelTokenMaxLifetime,
		&tunnelAgentAllowedCIDRs,
		&loginRateLimitWindow,
		&loginRateLimitMaxAttempts,
		&accountLockoutThreshold,
		&accountLockoutDuration,
		&impossibleTravelSpeed,
		&jwtExpires,
		&jwtRefreshExpires,
		&vaultDefaultTTL,
		&result.RecordingEnabled,
		&recordingRetentionDays,
		&fileUploadMaxSizeBytes,
		&userDriveQuotaBytes,
		&result.TeamCount,
		&result.CreatedAt,
		&result.UpdatedAt,
	); err != nil {
		return tenantResponse{}, fmt.Errorf("get tenant: %w", err)
	}

	result.VaultAutoLockMaxMinutes = nullInt(vaultAutoLock)
	result.TunnelTokenMaxLifetimeDays = nullInt(tunnelTokenMaxLifetime)
	result.LoginRateLimitWindowMs = nullInt(loginRateLimitWindow)
	result.LoginRateLimitMaxAttempts = nullInt(loginRateLimitMaxAttempts)
	result.AccountLockoutThreshold = nullInt(accountLockoutThreshold)
	result.AccountLockoutDurationMs = nullInt(accountLockoutDuration)
	result.ImpossibleTravelSpeedKmh = nullInt(impossibleTravelSpeed)
	result.JWTExpiresInSeconds = nullInt(jwtExpires)
	result.JWTRefreshExpiresInSeconds = nullInt(jwtRefreshExpires)
	result.VaultDefaultTTLMinutes = nullInt(vaultDefaultTTL)
	result.RecordingRetentionDays = nullInt(recordingRetentionDays)
	result.FileUploadMaxSizeBytes = nullInt(fileUploadMaxSizeBytes)
	result.UserDriveQuotaBytes = nullInt(userDriveQuotaBytes)
	result.TunnelAgentAllowedCIDRs = tunnelAgentAllowedCIDRs
	if len(enforcedConnectionSettings) > 0 {
		result.EnforcedConnectionSettings = json.RawMessage(enforcedConnectionSettings)
	}

	return result, nil
}

func (s Service) ListUserTenants(ctx context.Context, userID string) ([]tenantMembershipResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	tm."tenantId",
	t.name,
	t.slug,
	tm.role::text,
	tm.status::text,
	tm."isActive",
	tm."joinedAt"
FROM "TenantMember" tm
JOIN "Tenant" t ON t.id = tm."tenantId"
WHERE tm."userId" = $1
  AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
ORDER BY tm."joinedAt" ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("list user tenants: %w", err)
	}
	defer rows.Close()

	items := make([]tenantMembershipResponse, 0)
	for rows.Next() {
		var item tenantMembershipResponse
		if err := rows.Scan(
			&item.TenantID,
			&item.Name,
			&item.Slug,
			&item.Role,
			&item.Status,
			&item.IsActive,
			&item.JoinedAt,
		); err != nil {
			return nil, fmt.Errorf("scan user tenant: %w", err)
		}
		item.Pending = item.Status == "PENDING"
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate user tenants: %w", err)
	}

	sort.Slice(items, func(i, j int) bool {
		rank := func(item tenantMembershipResponse) int {
			if item.IsActive {
				return 0
			}
			if item.Pending {
				return 2
			}
			return 1
		}
		leftRank := rank(items[i])
		rightRank := rank(items[j])
		if leftRank != rightRank {
			return leftRank < rightRank
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})

	return items, nil
}

func (s Service) GetIPAllowlist(ctx context.Context, tenantID string) (ipAllowlistResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT "ipAllowlistEnabled", "ipAllowlistMode", "ipAllowlistEntries"
FROM "Tenant"
WHERE id = $1
`, tenantID)

	var (
		result  ipAllowlistResponse
		mode    sql.NullString
		entries []string
	)
	if err := row.Scan(&result.Enabled, &mode, &entries); err != nil {
		return ipAllowlistResponse{}, fmt.Errorf("get tenant ip allowlist: %w", err)
	}
	if mode.Valid && mode.String != "" {
		result.Mode = mode.String
	} else {
		result.Mode = "flag"
	}
	result.Entries = entries
	return result, nil
}

func (s Service) UpdateIPAllowlist(ctx context.Context, tenantID string, payload ipAllowlistResponse) (ipAllowlistResponse, error) {
	row := s.DB.QueryRow(ctx, `
UPDATE "Tenant"
SET
	"ipAllowlistEnabled" = $2,
	"ipAllowlistMode" = $3,
	"ipAllowlistEntries" = $4
WHERE id = $1
RETURNING "ipAllowlistEnabled", "ipAllowlistMode", "ipAllowlistEntries"
`, tenantID, payload.Enabled, payload.Mode, payload.Entries)

	var (
		result  ipAllowlistResponse
		mode    sql.NullString
		entries []string
	)
	if err := row.Scan(&result.Enabled, &mode, &entries); err != nil {
		return ipAllowlistResponse{}, fmt.Errorf("update tenant ip allowlist: %w", err)
	}
	if mode.Valid && mode.String != "" {
		result.Mode = mode.String
	} else {
		result.Mode = "flag"
	}
	result.Entries = entries
	return result, nil
}

func (s Service) GetTenantMFAStats(ctx context.Context, tenantID string) (map[string]int, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	COUNT(*)::int AS total,
	COUNT(*) FILTER (WHERE NOT u."totpEnabled" AND NOT u."smsMfaEnabled")::int AS "withoutMfa"
FROM "TenantMember" tm
JOIN "User" u ON u.id = tm."userId"
WHERE tm."tenantId" = $1
`, tenantID)

	var total, withoutMFA int
	if err := row.Scan(&total, &withoutMFA); err != nil {
		return nil, fmt.Errorf("get tenant mfa stats: %w", err)
	}
	return map[string]int{"total": total, "withoutMfa": withoutMFA}, nil
}

func (s Service) ListTenantUsers(ctx context.Context, tenantID string) ([]tenantUserResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	u.id,
	u.email,
	u.username,
	u."avatarData",
	tm.role::text,
	tm.status::text,
	u."totpEnabled",
	u."smsMfaEnabled",
	u.enabled,
	u."createdAt",
	tm."expiresAt"
FROM "TenantMember" tm
JOIN "User" u ON u.id = tm."userId"
WHERE tm."tenantId" = $1
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant users: %w", err)
	}
	defer rows.Close()

	result := make([]tenantUserResponse, 0)
	now := time.Now()
	for rows.Next() {
		var (
			item      tenantUserResponse
			username  sql.NullString
			avatar    sql.NullString
			expiresAt sql.NullTime
		)
		if err := rows.Scan(
			&item.ID,
			&item.Email,
			&username,
			&avatar,
			&item.Role,
			&item.Status,
			&item.TOTPEnabled,
			&item.SMSMFAEnabled,
			&item.Enabled,
			&item.CreatedAt,
			&expiresAt,
		); err != nil {
			return nil, fmt.Errorf("scan tenant user: %w", err)
		}
		if username.Valid {
			item.Username = &username.String
		}
		if avatar.Valid {
			item.AvatarData = &avatar.String
		}
		item.Pending = item.Status == "PENDING"
		if expiresAt.Valid {
			value := expiresAt.Time
			item.ExpiresAt = &value
			item.Expired = !value.After(now)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant users: %w", err)
	}

	roleOrder := map[string]int{
		"OWNER":      0,
		"ADMIN":      1,
		"OPERATOR":   2,
		"MEMBER":     3,
		"CONSULTANT": 4,
		"AUDITOR":    5,
		"GUEST":      6,
	}
	sort.Slice(result, func(i, j int) bool {
		leftPending := 0
		rightPending := 0
		if result[i].Pending {
			leftPending = 1
		}
		if result[j].Pending {
			rightPending = 1
		}
		if leftPending != rightPending {
			return leftPending < rightPending
		}
		leftOrder := roleOrder[result[i].Role]
		rightOrder := roleOrder[result[j].Role]
		if leftOrder != rightOrder {
			return leftOrder < rightOrder
		}
		return strings.ToLower(result[i].Email) < strings.ToLower(result[j].Email)
	})

	return result, nil
}

func (s Service) GetUserProfile(ctx context.Context, tenantID, targetUserID, viewerRole string) (tenantUserProfileResponse, error) {
	row := s.DB.QueryRow(ctx, `
SELECT
	tm.role::text,
	tm."joinedAt",
	u.id,
	u.username,
	u."avatarData",
	u.email,
	u."totpEnabled",
	u."smsMfaEnabled",
	u."webauthnEnabled",
	u."updatedAt"
FROM "TenantMember" tm
JOIN "User" u ON u.id = tm."userId"
WHERE tm."tenantId" = $1
  AND tm."userId" = $2
`, tenantID, targetUserID)

	var (
		result          tenantUserProfileResponse
		username        sql.NullString
		avatarData      sql.NullString
		email           sql.NullString
		totpEnabled     bool
		smsMFAEnabled   bool
		webAuthnEnabled bool
		updatedAt       time.Time
	)

	if err := row.Scan(
		&result.Role,
		&result.JoinedAt,
		&result.ID,
		&username,
		&avatarData,
		&email,
		&totpEnabled,
		&smsMFAEnabled,
		&webAuthnEnabled,
		&updatedAt,
	); err != nil {
		return tenantUserProfileResponse{}, fmt.Errorf("get tenant user profile: %w", err)
	}
	if username.Valid {
		result.Username = &username.String
	}
	if avatarData.Valid {
		result.AvatarData = &avatarData.String
	}

	teamRows, err := s.DB.Query(ctx, `
SELECT t.id, t.name, tm.role::text
FROM "TeamMember" tm
JOIN "Team" t ON t.id = tm."teamId"
WHERE tm."userId" = $1
  AND t."tenantId" = $2
ORDER BY t.name ASC
`, targetUserID, tenantID)
	if err != nil {
		return tenantUserProfileResponse{}, fmt.Errorf("list tenant user teams: %w", err)
	}
	defer teamRows.Close()

	result.Teams = make([]tenantUserProfileTeam, 0)
	for teamRows.Next() {
		var team tenantUserProfileTeam
		if err := teamRows.Scan(&team.ID, &team.Name, &team.Role); err != nil {
			return tenantUserProfileResponse{}, fmt.Errorf("scan tenant user team: %w", err)
		}
		result.Teams = append(result.Teams, team)
	}
	if err := teamRows.Err(); err != nil {
		return tenantUserProfileResponse{}, fmt.Errorf("iterate tenant user teams: %w", err)
	}

	if claimsCanAdminTenant(viewerRole) {
		if email.Valid {
			result.Email = &email.String
		}
		result.TOTPEnabled = &totpEnabled
		result.SMSMFAEnabled = &smsMFAEnabled
		result.WebAuthnEnabled = &webAuthnEnabled
		result.UpdatedAt = &updatedAt

		var lastActivity sql.NullTime
		if err := s.DB.QueryRow(ctx, `
SELECT "createdAt"
FROM "AuditLog"
WHERE "userId" = $1
ORDER BY "createdAt" DESC
LIMIT 1
`, targetUserID).Scan(&lastActivity); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return tenantUserProfileResponse{}, fmt.Errorf("get tenant user last activity: %w", err)
		}
		if lastActivity.Valid {
			value := lastActivity.Time
			result.LastActivity = &value
		}
	}

	return result, nil
}
