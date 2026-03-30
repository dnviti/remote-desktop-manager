package users

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
)

func (s Service) GetProfile(ctx context.Context, userID string) (Profile, error) {
	var profile Profile
	if s.DB == nil {
		return profile, fmt.Errorf("postgres is not configured")
	}

	var username, avatarData *string
	var sshDefaults, rdpDefaults []byte
	err := s.DB.QueryRow(
		ctx,
		`SELECT id,
		        email,
		        username,
		        "avatarData",
		        "sshDefaults",
		        "rdpDefaults",
		        "createdAt",
		        "vaultSetupComplete",
		        CASE WHEN "passwordHash" IS NULL OR "passwordHash" = '' THEN false ELSE true END AS "hasPassword"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&profile.ID,
		&profile.Email,
		&username,
		&avatarData,
		&sshDefaults,
		&rdpDefaults,
		&profile.CreatedAt,
		&profile.VaultSetupComplete,
		&profile.HasPassword,
	)
	if err != nil {
		return Profile{}, err
	}

	profile.Username = username
	profile.AvatarData = avatarData
	if len(sshDefaults) > 0 {
		profile.SSHDefaults = json.RawMessage(sshDefaults)
	}
	if len(rdpDefaults) > 0 {
		profile.RDPDefaults = json.RawMessage(rdpDefaults)
	}

	rows, err := s.DB.Query(
		ctx,
		`SELECT provider, "providerEmail", "createdAt"
		   FROM "OAuthAccount"
		  WHERE "userId" = $1
		  ORDER BY "createdAt" ASC`,
		userID,
	)
	if err != nil {
		return Profile{}, fmt.Errorf("query oauth accounts: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var account OAuthAccount
		if err := rows.Scan(&account.Provider, &account.ProviderEmail, &account.CreatedAt); err != nil {
			return Profile{}, fmt.Errorf("scan oauth account: %w", err)
		}
		profile.OAuthAccounts = append(profile.OAuthAccounts, account)
	}
	if err := rows.Err(); err != nil {
		return Profile{}, fmt.Errorf("iterate oauth accounts: %w", err)
	}

	if profile.OAuthAccounts == nil {
		profile.OAuthAccounts = []OAuthAccount{}
	}

	return profile, nil
}

func (s Service) UpdateProfile(ctx context.Context, userID string, username *string, ipAddress string) (updateProfileResult, error) {
	var result updateProfileResult
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return result, fmt.Errorf("begin update profile: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	err = tx.QueryRow(
		ctx,
		`UPDATE "User"
		    SET username = COALESCE($2, username),
		        "updatedAt" = NOW()
		  WHERE id = $1
		  RETURNING id, email, username, "avatarData"`,
		userID,
		username,
	).Scan(&result.ID, &result.Email, &result.Username, &result.AvatarData)
	if err != nil {
		return updateProfileResult{}, err
	}

	if err := insertAuditLog(ctx, tx, userID, "PROFILE_UPDATE", map[string]any{
		"fields": []string{"username"},
	}, ipAddress); err != nil {
		return updateProfileResult{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return updateProfileResult{}, fmt.Errorf("commit update profile: %w", err)
	}

	return result, nil
}

func (s Service) UpdateJSONPreference(ctx context.Context, userID, column string, payload map[string]any) (jsonPreferenceResult, error) {
	var result jsonPreferenceResult
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}

	rawPayload, err := json.Marshal(payload)
	if err != nil {
		return result, fmt.Errorf("marshal %s payload: %w", column, err)
	}

	query := fmt.Sprintf(
		`UPDATE "User"
		    SET "%s" = $2::jsonb,
		        "updatedAt" = NOW()
		  WHERE id = $1
		  RETURNING id, "%s"`,
		column,
		column,
	)

	err = s.DB.QueryRow(ctx, query, userID, string(rawPayload)).Scan(&result.ID, &result.Preference)
	if err != nil {
		return jsonPreferenceResult{}, err
	}

	return result, nil
}

func (s Service) SearchUsers(ctx context.Context, currentUserID, tenantID, query, scope, teamID string) ([]searchResult, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("postgres is not configured")
	}
	if scope == "team" && teamID == "" {
		return []searchResult{}, nil
	}

	sql := `
SELECT DISTINCT u.id, u.email, u.username, u."avatarData"
  FROM "User" u
  JOIN "TenantMember" tm
    ON tm."userId" = u.id
 WHERE tm."tenantId" = $1
   AND tm.status = 'ACCEPTED'
   AND u.id <> $2
   AND (
     u.email ILIKE '%' || $3 || '%'
     OR u.username ILIKE '%' || $3 || '%'
   )`

	args := []any{tenantID, currentUserID, query}
	if scope == "team" {
		sql += `
   AND EXISTS (
     SELECT 1
       FROM "TeamMember" team_member
      WHERE team_member."userId" = u.id
        AND team_member."teamId" = $4
   )`
		args = append(args, teamID)
	}

	sql += `
 ORDER BY u.email ASC
 LIMIT 10`

	rows, err := s.DB.Query(ctx, sql, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	results := make([]searchResult, 0)
	for rows.Next() {
		var item searchResult
		if err := rows.Scan(&item.ID, &item.Email, &item.Username, &item.AvatarData); err != nil {
			return nil, fmt.Errorf("scan search result: %w", err)
		}
		results = append(results, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate search results: %w", err)
	}

	return results, nil
}

func (s Service) UpdateAvatar(ctx context.Context, userID, avatarData string) (avatarResult, error) {
	var result avatarResult
	if s.DB == nil {
		return result, fmt.Errorf("postgres is not configured")
	}
	if !strings.HasPrefix(avatarData, "data:image/") {
		return result, fmt.Errorf("Invalid image format")
	}
	if len(avatarData) > maxAvatarSize {
		return result, fmt.Errorf("Avatar image too large (max 200KB)")
	}

	err := s.DB.QueryRow(
		ctx,
		`UPDATE "User"
		    SET "avatarData" = $2,
		        "updatedAt" = NOW()
		  WHERE id = $1
		  RETURNING id, "avatarData"`,
		userID,
		avatarData,
	).Scan(&result.ID, &result.AvatarData)
	if err != nil {
		return avatarResult{}, err
	}

	return result, nil
}
