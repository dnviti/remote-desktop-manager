package teams

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sort"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

func (s Service) DeleteTeam(ctx context.Context, teamID, userID, tenantID, ipAddress string) (map[string]any, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	membership, err := s.requireMembership(ctx, teamID, userID, tenantID)
	if err != nil {
		return nil, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return nil, &requestError{status: 403, message: "Insufficient team role"}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin team delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `UPDATE "Connection" SET "teamId" = NULL WHERE "teamId" = $1`, teamID); err != nil {
		return nil, fmt.Errorf("clear team connections: %w", err)
	}
	if _, err := tx.Exec(ctx, `UPDATE "Folder" SET "teamId" = NULL WHERE "teamId" = $1`, teamID); err != nil {
		return nil, fmt.Errorf("clear team folders: %w", err)
	}
	commandTag, err := tx.Exec(ctx, `DELETE FROM "Team" WHERE id = $1`, teamID)
	if err != nil {
		return nil, fmt.Errorf("delete team: %w", err)
	}
	if commandTag.RowsAffected() == 0 {
		return nil, pgx.ErrNoRows
	}
	if err := insertAuditLog(ctx, tx, userID, "TEAM_DELETE", "Team", teamID, nil, ipAddress); err != nil {
		return nil, fmt.Errorf("insert team delete audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit team delete: %w", err)
	}
	return map[string]any{"deleted": true}, nil
}

func (s Service) UpdateMemberRole(ctx context.Context, teamID, targetUserID, newRole, actingUserID, tenantID, ipAddress string) (map[string]any, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	if !isValidTeamRole(newRole) {
		return nil, &requestError{status: 400, message: "role must be one of TEAM_ADMIN, TEAM_EDITOR, TEAM_VIEWER"}
	}
	membership, err := s.requireMembership(ctx, teamID, actingUserID, tenantID)
	if err != nil {
		return nil, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return nil, &requestError{status: 403, message: "Insufficient team role"}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin team member role update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var currentRole string
	if err := tx.QueryRow(ctx, `
SELECT role::text
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, targetUserID).Scan(&currentRole); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{status: 404, message: "Member not found"}
		}
		return nil, fmt.Errorf("load team member: %w", err)
	}

	if currentRole == "TEAM_ADMIN" && newRole != "TEAM_ADMIN" {
		var adminCount int
		if err := tx.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "TeamMember"
WHERE "teamId" = $1 AND role = 'TEAM_ADMIN'
`, teamID).Scan(&adminCount); err != nil {
			return nil, fmt.Errorf("count team admins: %w", err)
		}
		if adminCount <= 1 {
			return nil, &requestError{status: 400, message: "Cannot demote the last team admin"}
		}
	}

	if _, err := tx.Exec(ctx, `
UPDATE "TeamMember"
SET role = $3::"TeamRole"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, targetUserID, newRole); err != nil {
		return nil, fmt.Errorf("update team member role: %w", err)
	}
	if err := insertAuditLog(ctx, tx, actingUserID, "TEAM_UPDATE_MEMBER_ROLE", "TeamMember", targetUserID, map[string]any{
		"teamId":  teamID,
		"newRole": newRole,
	}, ipAddress); err != nil {
		return nil, fmt.Errorf("insert team member role audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit team member role update: %w", err)
	}
	return map[string]any{"userId": targetUserID, "role": newRole}, nil
}

func (s Service) RemoveMember(ctx context.Context, teamID, targetUserID, actingUserID, tenantID, ipAddress string) (map[string]any, error) {
	if s.DB == nil {
		return nil, errors.New("database is unavailable")
	}
	membership, err := s.requireMembership(ctx, teamID, actingUserID, tenantID)
	if err != nil {
		return nil, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return nil, &requestError{status: 403, message: "Insufficient team role"}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin team member delete: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var targetRole string
	if err := tx.QueryRow(ctx, `
SELECT role::text
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, targetUserID).Scan(&targetRole); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, &requestError{status: 404, message: "Member not found"}
		}
		return nil, fmt.Errorf("load team member: %w", err)
	}

	if targetRole == "TEAM_ADMIN" {
		var adminCount int
		if err := tx.QueryRow(ctx, `
SELECT COUNT(*)::int
FROM "TeamMember"
WHERE "teamId" = $1 AND role = 'TEAM_ADMIN'
`, teamID).Scan(&adminCount); err != nil {
			return nil, fmt.Errorf("count team admins: %w", err)
		}
		if adminCount <= 1 {
			return nil, &requestError{status: 400, message: "Cannot remove the last team admin"}
		}
	}

	if _, err := tx.Exec(ctx, `
DELETE FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, targetUserID); err != nil {
		return nil, fmt.Errorf("remove team member: %w", err)
	}
	if err := insertAuditLog(ctx, tx, actingUserID, "TEAM_REMOVE_MEMBER", "TeamMember", targetUserID, map[string]any{
		"teamId": teamID,
	}, ipAddress); err != nil {
		return nil, fmt.Errorf("insert team member remove audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit team member delete: %w", err)
	}
	return map[string]any{"removed": true}, nil
}

func (s Service) UpdateMemberExpiry(ctx context.Context, teamID, targetUserID string, expiresAt *time.Time, actingUserID, tenantID, ipAddress string) (teamMemberResponse, error) {
	if s.DB == nil {
		return teamMemberResponse{}, errors.New("database is unavailable")
	}
	membership, err := s.requireMembership(ctx, teamID, actingUserID, tenantID)
	if err != nil {
		return teamMemberResponse{}, err
	}
	if membership.Role != "TEAM_ADMIN" {
		return teamMemberResponse{}, &requestError{status: 403, message: "Insufficient team role"}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return teamMemberResponse{}, fmt.Errorf("begin team member expiry update: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var result teamMemberResponse
	var (
		username     sql.NullString
		avatar       sql.NullString
		storedExpiry sql.NullTime
	)
	if err := tx.QueryRow(ctx, `
UPDATE "TeamMember" tm
SET "expiresAt" = $3
FROM "User" u
WHERE tm."teamId" = $1
  AND tm."userId" = $2
  AND u.id = tm."userId"
RETURNING u.id, u.email, u.username, u."avatarData", tm.role::text, tm."joinedAt", tm."expiresAt"
`, teamID, targetUserID, expiresAt).Scan(
		&result.UserID,
		&result.Email,
		&username,
		&avatar,
		&result.Role,
		&result.JoinedAt,
		&storedExpiry,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return teamMemberResponse{}, &requestError{status: 404, message: "Member not found"}
		}
		return teamMemberResponse{}, fmt.Errorf("update team member expiry: %w", err)
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
	if err := insertAuditLog(ctx, tx, actingUserID, "TEAM_MEMBERSHIP_EXPIRY_UPDATE", "TeamMember", targetUserID, map[string]any{
		"teamId":    teamID,
		"expiresAt": expiryValue,
	}, ipAddress); err != nil {
		return teamMemberResponse{}, fmt.Errorf("insert team member expiry audit: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return teamMemberResponse{}, fmt.Errorf("commit team member expiry update: %w", err)
	}
	return result, nil
}

func (s Service) requireMembership(ctx context.Context, teamID, userID, tenantID string) (membership, error) {
	row := s.DB.QueryRow(ctx, `
SELECT tm.role::text, t."tenantId"
FROM "TeamMember" tm
JOIN "Team" t ON t.id = tm."teamId"
WHERE tm."teamId" = $1
  AND tm."userId" = $2
`, teamID, userID)

	var result membership
	if err := row.Scan(&result.Role, &result.TenantID); err != nil {
		return membership{}, err
	}
	if result.TenantID != tenantID {
		return membership{}, &requestError{status: 403, message: "Access denied"}
	}
	return result, nil
}

func sortTeamMembers(items []teamMemberResponse) {
	roleRank := map[string]int{
		"TEAM_VIEWER": 1,
		"TEAM_EDITOR": 2,
		"TEAM_ADMIN":  3,
	}
	sort.Slice(items, func(i, j int) bool {
		leftRank := roleRank[items[i].Role]
		rightRank := roleRank[items[j].Role]
		if leftRank != rightRank {
			return leftRank > rightRank
		}
		return items[i].JoinedAt.Before(items[j].JoinedAt)
	})
}

func writeError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		app.ErrorJSON(w, http.StatusNotFound, "Team not found")
		return
	}
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}

func isValidTeamRole(role string) bool {
	switch strings.TrimSpace(role) {
	case "TEAM_ADMIN", "TEAM_EDITOR", "TEAM_VIEWER":
		return true
	default:
		return false
	}
}

func changedTeamFields(payload updateTeamPayload) []string {
	fields := make([]string, 0, 2)
	if payload.Name.Present {
		fields = append(fields, "name")
	}
	if payload.Description.Present {
		fields = append(fields, "description")
	}
	return fields
}

func requestIP(r *http.Request) string {
	for _, value := range []string{
		r.Header.Get("X-Real-IP"),
		firstForwardedFor(r.Header.Get("X-Forwarded-For")),
		r.RemoteAddr,
	} {
		ip := stripIP(value)
		if ip != "" {
			return ip
		}
	}
	return ""
}

func firstForwardedFor(value string) string {
	parts := strings.Split(value, ",")
	if len(parts) == 0 {
		return ""
	}
	return strings.TrimSpace(parts[0])
}

func stripIP(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return value
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	var payload any
	if details != nil {
		rawDetails, err := json.Marshal(details)
		if err != nil {
			return fmt.Errorf("marshal audit details: %w", err)
		}
		payload = string(rawDetails)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", $4, $5, $6::jsonb, NULLIF($7, ''))
`, uuid.NewString(), userID, action, targetType, targetID, payload, ipAddress); err != nil {
		return err
	}
	return nil
}

func (s Service) getVaultMasterKey(ctx context.Context, userID string) ([]byte, time.Duration, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, 0, nil
	}

	userKey := "vault:user:" + userID
	recoveryKey := "vault:recovery:" + userID
	keys := []string{userKey, recoveryKey}

	for _, key := range keys {
		payload, err := s.Redis.Get(ctx, key).Bytes()
		if err != nil {
			if errors.Is(err, redis.Nil) {
				continue
			}
			return nil, 0, fmt.Errorf("load vault session: %w", err)
		}

		var field encryptedField
		normalized, err := rediscompat.DecodeJSONPayload(payload, &field)
		if err != nil {
			return nil, 0, fmt.Errorf("decode vault session payload format: %w", err)
		}

		hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
		if err != nil {
			return nil, 0, fmt.Errorf("decrypt vault session: %w", err)
		}
		masterKey, err := hex.DecodeString(hexKey)
		if err != nil {
			return nil, 0, fmt.Errorf("decode vault master key: %w", err)
		}

		var ttl time.Duration
		if pttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && pttl > 0 {
			ttl = pttl
		}

		if key == userKey {
			if ttl > 0 {
				_ = s.Redis.Set(ctx, userKey, normalized, ttl).Err()
			}
			return masterKey, ttl, nil
		}

		if ttl <= 0 {
			ttl = s.VaultTTL
		}
		if ttl <= 0 {
			ttl = 30 * time.Minute
		}

		_ = s.Redis.Set(ctx, userKey, normalized, ttl).Err()
		return masterKey, ttl, nil
	}

	return nil, 0, nil
}

func (s Service) getCachedTeamKey(ctx context.Context, teamID, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil, nil
	}

	key := fmt.Sprintf("vault:team:%s:%s", teamID, userID)
	payload, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load team vault session: %w", err)
	}

	var field encryptedField
	normalized, err := rediscompat.DecodeJSONPayload(payload, &field)
	if err != nil {
		return nil, fmt.Errorf("decode team vault session payload: %w", err)
	}

	hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt team vault session: %w", err)
	}
	teamKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode team vault key: %w", err)
	}

	if pttl, ttlErr := s.Redis.PTTL(ctx, key).Result(); ttlErr == nil && pttl > 0 {
		_ = s.Redis.Set(ctx, key, normalized, pttl).Err()
	}
	return teamKey, nil
}

func (s Service) storeTeamVaultSession(ctx context.Context, teamID, userID string, teamKey []byte, ttl time.Duration) error {
	if s.Redis == nil || len(s.ServerEncryptionKey) == 0 {
		return nil
	}
	if ttl <= 0 {
		ttl = s.VaultTTL
	}
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}

	field, err := encryptHexPayload(s.ServerEncryptionKey, hex.EncodeToString(teamKey))
	if err != nil {
		return fmt.Errorf("encrypt team vault session: %w", err)
	}
	raw, err := json.Marshal(field)
	if err != nil {
		return fmt.Errorf("marshal team vault session: %w", err)
	}
	if err := s.Redis.Set(ctx, fmt.Sprintf("vault:team:%s:%s", teamID, userID), raw, ttl).Err(); err != nil {
		return fmt.Errorf("store team vault session: %w", err)
	}
	return nil
}
