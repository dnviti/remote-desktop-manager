package teams

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

func (s Service) ListUserTeams(ctx context.Context, userID, tenantID string) ([]teamResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	t.id,
	t.name,
	t.description,
	COUNT(tm_all.id)::int AS "memberCount",
	tm_user.role::text AS "myRole",
	t."createdAt"
FROM "Team" t
JOIN "TeamMember" tm_user
  ON tm_user."teamId" = t.id
 AND tm_user."userId" = $1
LEFT JOIN "TeamMember" tm_all
  ON tm_all."teamId" = t.id
WHERE t."tenantId" = $2
GROUP BY t.id, tm_user.role
ORDER BY t.name ASC
`, userID, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list user teams: %w", err)
	}
	defer rows.Close()

	items := make([]teamResponse, 0)
	for rows.Next() {
		var item teamResponse
		var description sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&description,
			&item.MemberCount,
			&item.MyRole,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan team: %w", err)
		}
		if description.Valid {
			item.Description = &description.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate teams: %w", err)
	}

	return items, nil
}

func (s Service) ListTenantTeams(ctx context.Context, tenantID string) ([]teamResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT
	t.id,
	t.name,
	t.description,
	COUNT(tm_all.id)::int AS "memberCount",
	'' AS "myRole",
	t."createdAt"
FROM "Team" t
LEFT JOIN "TeamMember" tm_all
  ON tm_all."teamId" = t.id
WHERE t."tenantId" = $1
GROUP BY t.id
ORDER BY t.name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list tenant teams: %w", err)
	}
	defer rows.Close()

	items := make([]teamResponse, 0)
	for rows.Next() {
		var item teamResponse
		var description sql.NullString
		if err := rows.Scan(
			&item.ID,
			&item.Name,
			&description,
			&item.MemberCount,
			&item.MyRole,
			&item.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan tenant team: %w", err)
		}
		if description.Valid {
			item.Description = &description.String
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant teams: %w", err)
	}
	return items, nil
}

func (s Service) GetTeam(ctx context.Context, teamID, userID, tenantID string) (teamResponse, error) {
	membership, err := s.requireMembership(ctx, teamID, userID, tenantID)
	if err != nil {
		return teamResponse{}, err
	}

	row := s.DB.QueryRow(ctx, `
SELECT
	t.id,
	t.name,
	t.description,
	(
		SELECT COUNT(*)::int
		FROM "TeamMember" tm
		WHERE tm."teamId" = t.id
	) AS "memberCount",
	t."createdAt",
	t."updatedAt"
FROM "Team" t
WHERE t.id = $1
`, teamID)

	var (
		result      teamResponse
		description sql.NullString
		updatedAt   time.Time
	)
	if err := row.Scan(
		&result.ID,
		&result.Name,
		&description,
		&result.MemberCount,
		&result.CreatedAt,
		&updatedAt,
	); err != nil {
		return teamResponse{}, fmt.Errorf("get team: %w", err)
	}
	if description.Valid {
		result.Description = &description.String
	}
	result.MyRole = membership.Role
	result.UpdatedAt = &updatedAt
	return result, nil
}

func (s Service) ListMembers(ctx context.Context, teamID, userID, tenantID string) ([]teamMemberResponse, error) {
	if _, err := s.requireMembership(ctx, teamID, userID, tenantID); err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(ctx, `
SELECT
	u.id,
	u.email,
	u.username,
	u."avatarData",
	tm.role::text,
	tm."joinedAt",
	tm."expiresAt"
FROM "TeamMember" tm
JOIN "User" u ON u.id = tm."userId"
WHERE tm."teamId" = $1
ORDER BY tm."joinedAt" ASC
`, teamID)
	if err != nil {
		return nil, fmt.Errorf("list team members: %w", err)
	}
	defer rows.Close()

	items := make([]teamMemberResponse, 0)
	now := time.Now()
	for rows.Next() {
		var (
			item      teamMemberResponse
			username  sql.NullString
			avatar    sql.NullString
			expiresAt sql.NullTime
		)
		if err := rows.Scan(
			&item.UserID,
			&item.Email,
			&username,
			&avatar,
			&item.Role,
			&item.JoinedAt,
			&expiresAt,
		); err != nil {
			return nil, fmt.Errorf("scan team member: %w", err)
		}
		if username.Valid {
			item.Username = &username.String
		}
		if avatar.Valid {
			item.AvatarData = &avatar.String
		}
		if expiresAt.Valid {
			value := expiresAt.Time
			item.ExpiresAt = &value
			item.Expired = !value.After(now)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate team members: %w", err)
	}

	sortTeamMembers(items)
	return items, nil
}
