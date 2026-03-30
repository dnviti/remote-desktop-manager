package teams

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

func (s Service) CreateTeam(ctx context.Context, tenantID, creatorUserID string, payload createTeamPayload, ipAddress string) (teamResponse, error) {
	if s.DB == nil {
		return teamResponse{}, errors.New("database is unavailable")
	}

	name := strings.TrimSpace(payload.Name)
	if len(name) < 2 || len(name) > 100 {
		return teamResponse{}, &requestError{status: 400, message: "name must be between 2 and 100 characters"}
	}
	var description *string
	if payload.Description != nil {
		value := strings.TrimSpace(*payload.Description)
		if len(value) > 500 {
			return teamResponse{}, &requestError{status: 400, message: "description must be 500 characters or fewer"}
		}
		description = &value
	}

	userMasterKey, ttl, err := s.getVaultMasterKey(ctx, creatorUserID)
	if err != nil {
		return teamResponse{}, err
	}
	if len(userMasterKey) == 0 {
		return teamResponse{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(userMasterKey)

	teamKey, err := generateRandomKey()
	if err != nil {
		return teamResponse{}, fmt.Errorf("generate team key: %w", err)
	}
	defer zeroBytes(teamKey)

	encKey, err := encryptHexPayload(userMasterKey, hex.EncodeToString(teamKey))
	if err != nil {
		return teamResponse{}, fmt.Errorf("encrypt team key: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return teamResponse{}, fmt.Errorf("begin team create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now().UTC()
	var result teamResponse
	var desc sql.NullString
	var updatedAt time.Time
	if err := tx.QueryRow(ctx, `
INSERT INTO "Team" (id, name, description, "tenantId", "createdAt", "updatedAt")
VALUES ($1, $2, $3, $4, $5, $5)
RETURNING id, name, description, "createdAt", "updatedAt"
`, uuid.NewString(), name, description, tenantID, now).Scan(&result.ID, &result.Name, &desc, &result.CreatedAt, &updatedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return teamResponse{}, &requestError{status: 409, message: "A team with this name already exists"}
		}
		return teamResponse{}, fmt.Errorf("create team: %w", err)
	}
	if desc.Valid {
		result.Description = &desc.String
	}
	result.MemberCount = 1
	result.MyRole = "TEAM_ADMIN"
	result.UpdatedAt = &updatedAt

	if _, err := tx.Exec(ctx, `
INSERT INTO "TeamMember" (
	id, "teamId", "userId", role,
	"encryptedTeamVaultKey", "teamVaultKeyIV", "teamVaultKeyTag"
)
VALUES ($1, $2, $3, 'TEAM_ADMIN', $4, $5, $6)
`, uuid.NewString(), result.ID, creatorUserID, encKey.Ciphertext, encKey.IV, encKey.Tag); err != nil {
		return teamResponse{}, fmt.Errorf("create team membership: %w", err)
	}

	if err := insertAuditLog(ctx, tx, creatorUserID, "TEAM_CREATE", "Team", result.ID, map[string]any{
		"name": name,
	}, ipAddress); err != nil {
		return teamResponse{}, fmt.Errorf("insert team create audit: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return teamResponse{}, fmt.Errorf("commit team create: %w", err)
	}
	if err := s.storeTeamVaultSession(ctx, result.ID, creatorUserID, teamKey, ttl); err != nil {
		return teamResponse{}, err
	}
	return result, nil
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

func (s Service) AddMember(ctx context.Context, teamID, targetUserID, role string, expiresAt *time.Time, actingUserID, tenantID, ipAddress string) (teamMemberResponse, error) {
	if s.DB == nil {
		return teamMemberResponse{}, errors.New("database is unavailable")
	}
	if !isValidTeamRole(role) {
		return teamMemberResponse{}, &requestError{status: 400, message: "role must be one of TEAM_ADMIN, TEAM_EDITOR, TEAM_VIEWER"}
	}
	membership, err := s.requireMembership(ctx, teamID, actingUserID, tenantID)
	if err != nil {
		return teamMemberResponse{}, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return teamMemberResponse{}, &requestError{status: 403, message: "Insufficient team role"}
	}

	actingMasterKey, actingTTL, err := s.getVaultMasterKey(ctx, actingUserID)
	if err != nil {
		return teamMemberResponse{}, err
	}
	if len(actingMasterKey) == 0 {
		return teamMemberResponse{}, &requestError{status: 403, message: "Your vault is locked. Please unlock it first."}
	}
	defer zeroBytes(actingMasterKey)

	targetMasterKey, _, err := s.getVaultMasterKey(ctx, targetUserID)
	if err != nil {
		return teamMemberResponse{}, err
	}
	if len(targetMasterKey) == 0 {
		return teamMemberResponse{}, &requestError{status: 403, message: "Target user's vault is locked. They must unlock their vault first."}
	}
	defer zeroBytes(targetMasterKey)

	teamKey, err := s.getCachedTeamKey(ctx, teamID, actingUserID)
	if err != nil {
		return teamMemberResponse{}, err
	}
	if len(teamKey) == 0 {
		var encField encryptedField
		row := s.DB.QueryRow(ctx, `
SELECT "encryptedTeamVaultKey", "teamVaultKeyIV", "teamVaultKeyTag"
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, actingUserID)
		if err := row.Scan(&encField.Ciphertext, &encField.IV, &encField.Tag); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return teamMemberResponse{}, &requestError{status: 404, message: "Member not found"}
			}
			return teamMemberResponse{}, fmt.Errorf("load acting member team key: %w", err)
		}
		if strings.TrimSpace(encField.Ciphertext) == "" || strings.TrimSpace(encField.IV) == "" || strings.TrimSpace(encField.Tag) == "" {
			return teamMemberResponse{}, &requestError{status: 500, message: "Unable to access team vault key"}
		}
		hexKey, err := decryptEncryptedField(actingMasterKey, encField)
		if err != nil {
			return teamMemberResponse{}, &requestError{status: 500, message: "Unable to access team vault key"}
		}
		teamKey, err = hex.DecodeString(hexKey)
		if err != nil {
			return teamMemberResponse{}, fmt.Errorf("decode team key: %w", err)
		}
		defer zeroBytes(teamKey)
		if err := s.storeTeamVaultSession(ctx, teamID, actingUserID, teamKey, actingTTL); err != nil {
			return teamMemberResponse{}, err
		}
	}
	defer zeroBytes(teamKey)

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return teamMemberResponse{}, fmt.Errorf("begin team member create: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var teamTenantID string
	if err := tx.QueryRow(ctx, `SELECT "tenantId" FROM "Team" WHERE id = $1`, teamID).Scan(&teamTenantID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return teamMemberResponse{}, pgx.ErrNoRows
		}
		return teamMemberResponse{}, fmt.Errorf("load team: %w", err)
	}
	if teamTenantID != tenantID {
		return teamMemberResponse{}, &requestError{status: 403, message: "Access denied"}
	}

	var accepted bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1
	FROM "TenantMember"
	WHERE "tenantId" = $1
	  AND "userId" = $2
	  AND status = 'ACCEPTED'
	  AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
)
`, tenantID, targetUserID).Scan(&accepted); err != nil {
		return teamMemberResponse{}, fmt.Errorf("check tenant membership: %w", err)
	}
	if !accepted {
		return teamMemberResponse{}, &requestError{status: 400, message: "User is not a member of this organization"}
	}

	var exists bool
	if err := tx.QueryRow(ctx, `
SELECT EXISTS(
	SELECT 1
	FROM "TeamMember"
	WHERE "teamId" = $1 AND "userId" = $2
)
`, teamID, targetUserID).Scan(&exists); err != nil {
		return teamMemberResponse{}, fmt.Errorf("check team membership: %w", err)
	}
	if exists {
		return teamMemberResponse{}, &requestError{status: 400, message: "User is already a team member"}
	}

	encKey, err := encryptHexPayload(targetMasterKey, hex.EncodeToString(teamKey))
	if err != nil {
		return teamMemberResponse{}, fmt.Errorf("encrypt team key for target member: %w", err)
	}

	var result teamMemberResponse
	var (
		username     sql.NullString
		avatar       sql.NullString
		storedExpiry sql.NullTime
	)
	if err := tx.QueryRow(ctx, `
WITH inserted AS (
	INSERT INTO "TeamMember" (
		id, "teamId", "userId", role,
		"encryptedTeamVaultKey", "teamVaultKeyIV", "teamVaultKeyTag", "expiresAt"
	)
	VALUES ($1, $2, $3, $4::"TeamRole", $5, $6, $7, $8)
	RETURNING "userId", role::text, "joinedAt", "expiresAt"
)
SELECT u.id, u.email, u.username, u."avatarData", i.role, i."joinedAt", i."expiresAt"
FROM inserted i
JOIN "User" u ON u.id = i."userId"
`, uuid.NewString(), teamID, targetUserID, role, encKey.Ciphertext, encKey.IV, encKey.Tag, expiresAt).Scan(
		&result.UserID,
		&result.Email,
		&username,
		&avatar,
		&result.Role,
		&result.JoinedAt,
		&storedExpiry,
	); err != nil {
		return teamMemberResponse{}, fmt.Errorf("create team member: %w", err)
	}
	if username.Valid {
		result.Username = &username.String
	}
	if avatar.Valid {
		result.AvatarData = &avatar.String
	}
	if storedExpiry.Valid {
		value := storedExpiry.Time
		result.ExpiresAt = &value
		result.Expired = !value.After(time.Now())
	}

	var expiryValue any
	if result.ExpiresAt != nil {
		expiryValue = result.ExpiresAt.Format(time.RFC3339)
	}
	if err := insertAuditLog(ctx, tx, actingUserID, "TEAM_ADD_MEMBER", "TeamMember", targetUserID, map[string]any{
		"teamId":    teamID,
		"role":      role,
		"expiresAt": expiryValue,
	}, ipAddress); err != nil {
		return teamMemberResponse{}, fmt.Errorf("insert team member create audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return teamMemberResponse{}, fmt.Errorf("commit team member create: %w", err)
	}
	return result, nil
}

func (s Service) UpdateTeam(ctx context.Context, teamID, userID, tenantID string, payload updateTeamPayload, ipAddress string) (teamResponse, error) {
	if s.DB == nil {
		return teamResponse{}, errors.New("database is unavailable")
	}
	membership, err := s.requireMembership(ctx, teamID, userID, tenantID)
	if err != nil {
		return teamResponse{}, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return teamResponse{}, &requestError{status: 403, message: "Insufficient team role"}
	}

	setClauses := make([]string, 0, 3)
	args := []any{teamID}
	addClause := func(clause string, value any) {
		args = append(args, value)
		setClauses = append(setClauses, fmt.Sprintf(clause, len(args)))
	}

	if payload.Name.Present {
		if payload.Name.Value == nil || strings.TrimSpace(*payload.Name.Value) == "" {
			return teamResponse{}, &requestError{status: 400, message: "name cannot be empty"}
		}
		name := strings.TrimSpace(*payload.Name.Value)
		if len(name) < 2 || len(name) > 100 {
			return teamResponse{}, &requestError{status: 400, message: "name must be between 2 and 100 characters"}
		}
		addClause(`name = $%d`, name)
	}
	if payload.Description.Present {
		if payload.Description.Value == nil {
			addClause(`description = $%d`, nil)
		} else {
			description := strings.TrimSpace(*payload.Description.Value)
			if len(description) > 500 {
				return teamResponse{}, &requestError{status: 400, message: "description must be 500 characters or fewer"}
			}
			addClause(`description = $%d`, description)
		}
	}
	if len(setClauses) == 0 {
		return teamResponse{}, &requestError{status: 400, message: "No fields to update"}
	}

	args = append(args, time.Now().UTC())
	setClauses = append(setClauses, fmt.Sprintf(`"updatedAt" = $%d`, len(args)))
	query := fmt.Sprintf(`
UPDATE "Team"
SET %s
WHERE id = $1
RETURNING id, name, description, "createdAt", "updatedAt"
`, strings.Join(setClauses, ", "))

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return teamResponse{}, fmt.Errorf("begin team update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		result      teamResponse
		description sql.NullString
		updatedAt   time.Time
	)
	if err := tx.QueryRow(ctx, query, args...).Scan(&result.ID, &result.Name, &description, &result.CreatedAt, &updatedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return teamResponse{}, &requestError{status: 409, message: "A team with this name already exists"}
		}
		return teamResponse{}, fmt.Errorf("update team: %w", err)
	}
	if description.Valid {
		result.Description = &description.String
	}
	result.MyRole = membership.Role
	result.UpdatedAt = &updatedAt

	if err := insertAuditLog(ctx, tx, userID, "TEAM_UPDATE", "Team", teamID, map[string]any{
		"fields": changedTeamFields(payload),
	}, ipAddress); err != nil {
		return teamResponse{}, fmt.Errorf("insert team update audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return teamResponse{}, fmt.Errorf("commit team update: %w", err)
	}
	return result, nil
}
