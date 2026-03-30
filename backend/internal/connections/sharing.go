package connections

import (
	"context"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/rediscompat"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

type shareTargetUser struct {
	ID    string
	Email string
}

type sourceCredentials struct {
	Username encryptedField
	Password encryptedField
	Domain   *encryptedField
}

func (s Service) ShareConnection(ctx context.Context, claims authn.Claims, connectionID string, target shareTarget, permission string, ip *string) (shareMutationResponse, error) {
	access, err := s.resolveShareableConnection(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return shareMutationResponse{}, err
	}

	targetUser, err := s.resolveShareTargetUser(ctx, target)
	if err != nil {
		return shareMutationResponse{}, err
	}
	if targetUser.ID == claims.UserID {
		return shareMutationResponse{}, &requestError{status: http.StatusBadRequest, message: "Cannot share with yourself"}
	}
	if err := s.assertShareableTenantBoundary(ctx, claims.UserID, targetUser.ID); err != nil {
		return shareMutationResponse{}, err
	}

	targetKey, err := s.getVaultKey(ctx, targetUser.ID)
	if err != nil {
		return shareMutationResponse{}, err
	}
	if len(targetKey) == 0 {
		return shareMutationResponse{}, &requestError{status: http.StatusBadRequest, message: "Unable to share with this user at this time."}
	}
	defer zeroBytes(targetKey)

	var encryptedUsername any
	var usernameIV any
	var usernameTag any
	var encryptedPassword any
	var passwordIV any
	var passwordTag any
	var encryptedDomain any
	var domainIV any
	var domainTag any

	if access.Connection.CredentialSecretID == nil {
		sourceKey, err := s.loadSharingSourceKey(ctx, claims.UserID, access.Connection)
		if err != nil {
			return shareMutationResponse{}, err
		}
		defer zeroBytes(sourceKey)

		sourceCreds, err := s.loadSharableCredentials(ctx, access.Connection.ID)
		if err != nil {
			return shareMutationResponse{}, err
		}
		encUsername, encPassword, encDomainField, err := reencryptSharedCredentials(sourceKey, targetKey, sourceCreds)
		if err != nil {
			return shareMutationResponse{}, err
		}
		encryptedUsername, usernameIV, usernameTag = encUsername.Ciphertext, encUsername.IV, encUsername.Tag
		encryptedPassword, passwordIV, passwordTag = encPassword.Ciphertext, encPassword.IV, encPassword.Tag
		encryptedDomain, domainIV, domainTag = nullCiphertext(encDomainField), nullIV(encDomainField), nullTag(encDomainField)
	}

	var result shareMutationResponse
	if err := s.DB.QueryRow(ctx, `
INSERT INTO "SharedConnection" (
	id,
	"connectionId",
	"sharedWithUserId",
	"sharedByUserId",
	permission,
	"encryptedUsername",
	"usernameIV",
	"usernameTag",
	"encryptedPassword",
	"passwordIV",
	"passwordTag",
	"encryptedDomain",
	"domainIV",
	"domainTag",
	"createdAt"
)
VALUES ($1, $2, $3, $4, $5::"Permission", $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
ON CONFLICT ("connectionId", "sharedWithUserId")
DO UPDATE SET
	permission = EXCLUDED.permission,
	"sharedByUserId" = EXCLUDED."sharedByUserId",
	"encryptedUsername" = EXCLUDED."encryptedUsername",
	"usernameIV" = EXCLUDED."usernameIV",
	"usernameTag" = EXCLUDED."usernameTag",
	"encryptedPassword" = EXCLUDED."encryptedPassword",
	"passwordIV" = EXCLUDED."passwordIV",
	"passwordTag" = EXCLUDED."passwordTag",
	"encryptedDomain" = EXCLUDED."encryptedDomain",
	"domainIV" = EXCLUDED."domainIV",
	"domainTag" = EXCLUDED."domainTag"
RETURNING id, permission::text
`, uuid.NewString(), access.Connection.ID, targetUser.ID, claims.UserID, permission, encryptedUsername, usernameIV, usernameTag, encryptedPassword, passwordIV, passwordTag, encryptedDomain, domainIV, domainTag).Scan(&result.ID, &result.Permission); err != nil {
		return shareMutationResponse{}, fmt.Errorf("upsert shared connection: %w", err)
	}
	result.SharedWith = targetUser.Email

	actorName, err := s.lookupActorName(ctx, claims.UserID)
	if err != nil {
		return shareMutationResponse{}, err
	}
	permissionLabel := "Read Only"
	if permission == "FULL_ACCESS" {
		permissionLabel = "Full Access"
	}
	if err := s.insertNotification(ctx, targetUser.ID, "CONNECTION_SHARED", fmt.Sprintf(`%s shared "%s" with you (%s)`, actorName, access.Connection.Name, permissionLabel), access.Connection.ID); err != nil {
		return shareMutationResponse{}, err
	}
	if err := s.insertAuditLog(ctx, claims.UserID, "SHARE_CONNECTION", access.Connection.ID, map[string]any{
		"sharedWith": targetUser.ID,
		"permission": permission,
	}, ip); err != nil {
		return shareMutationResponse{}, err
	}
	return result, nil
}

func (s Service) BatchShareConnections(ctx context.Context, claims authn.Claims, payload batchSharePayload, ip *string) (batchShareResponse, error) {
	if _, err := s.resolveShareTargetUser(ctx, payload.Target); err != nil {
		return batchShareResponse{}, err
	}

	result := batchShareResponse{Errors: make([]batchShareResultReason, 0)}
	for _, connectionID := range payload.ConnectionIDs {
		if _, err := s.ShareConnection(ctx, claims, connectionID, payload.Target, payload.Permission, ip); err != nil {
			result.Failed++
			reason := err.Error()
			var reqErr *requestError
			if errors.As(err, &reqErr) {
				reason = reqErr.message
			}
			result.Errors = append(result.Errors, batchShareResultReason{
				ConnectionID: connectionID,
				Reason:       reason,
			})
			continue
		}
		result.Shared++
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "BATCH_SHARE", "", map[string]any{
		"connectionCount": len(payload.ConnectionIDs),
		"shared":          result.Shared,
		"failed":          result.Failed,
		"permission":      payload.Permission,
		"folderName":      normalizeOptionalStringPtrValue(payload.FolderName),
	}, ip); err != nil {
		return batchShareResponse{}, err
	}
	return result, nil
}

func (s Service) UnshareConnection(ctx context.Context, claims authn.Claims, connectionID, targetUserID string, ip *string) error {
	access, err := s.resolveShareableConnection(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return err
	}
	if _, err := uuid.Parse(strings.TrimSpace(targetUserID)); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "invalid userId"}
	}

	if _, err := s.DB.Exec(ctx, `DELETE FROM "SharedConnection" WHERE "connectionId" = $1 AND "sharedWithUserId" = $2`, access.Connection.ID, targetUserID); err != nil {
		return fmt.Errorf("delete shared connection: %w", err)
	}

	actorName, err := s.lookupActorName(ctx, claims.UserID)
	if err != nil {
		return err
	}
	if err := s.insertNotification(ctx, targetUserID, "SHARE_REVOKED", fmt.Sprintf(`%s revoked your access to "%s"`, actorName, access.Connection.Name), access.Connection.ID); err != nil {
		return err
	}
	return s.insertAuditLog(ctx, claims.UserID, "UNSHARE_CONNECTION", access.Connection.ID, map[string]any{
		"targetUserId": targetUserID,
	}, ip)
}

func (s Service) UpdateSharePermission(ctx context.Context, claims authn.Claims, connectionID, targetUserID, permission string, ip *string) (shareMutationResponse, error) {
	access, err := s.resolveShareableConnection(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return shareMutationResponse{}, err
	}
	if _, err := uuid.Parse(strings.TrimSpace(targetUserID)); err != nil {
		return shareMutationResponse{}, &requestError{status: http.StatusBadRequest, message: "invalid userId"}
	}

	var result shareMutationResponse
	if err := s.DB.QueryRow(ctx, `
UPDATE "SharedConnection"
SET permission = $3::"Permission"
WHERE "connectionId" = $1 AND "sharedWithUserId" = $2
RETURNING id, permission::text
`, access.Connection.ID, targetUserID, permission).Scan(&result.ID, &result.Permission); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return shareMutationResponse{}, &requestError{status: http.StatusNotFound, message: "Share not found"}
		}
		return shareMutationResponse{}, fmt.Errorf("update shared connection permission: %w", err)
	}

	if err := s.DB.QueryRow(ctx, `SELECT email FROM "User" WHERE id = $1`, targetUserID).Scan(&result.SharedWith); err != nil {
		return shareMutationResponse{}, fmt.Errorf("load shared user email: %w", err)
	}

	actorName, err := s.lookupActorName(ctx, claims.UserID)
	if err != nil {
		return shareMutationResponse{}, err
	}
	permissionLabel := "Read Only"
	if permission == "FULL_ACCESS" {
		permissionLabel = "Full Access"
	}
	if err := s.insertNotification(ctx, targetUserID, "SHARE_PERMISSION_UPDATED", fmt.Sprintf(`%s changed your permission on "%s" to %s`, actorName, access.Connection.Name, permissionLabel), access.Connection.ID); err != nil {
		return shareMutationResponse{}, err
	}
	if err := s.insertAuditLog(ctx, claims.UserID, "UPDATE_SHARE_PERMISSION", access.Connection.ID, map[string]any{
		"targetUserId": targetUserID,
		"permission":   permission,
	}, ip); err != nil {
		return shareMutationResponse{}, err
	}
	return result, nil
}

func (s Service) ListShares(ctx context.Context, claims authn.Claims, connectionID string) ([]shareListEntry, error) {
	access, err := s.resolveShareableConnection(ctx, claims.UserID, claims.TenantID, connectionID)
	if err != nil {
		return nil, err
	}

	rows, err := s.DB.Query(ctx, `
SELECT sc.id, u.id, u.email, sc.permission::text, sc."createdAt"
FROM "SharedConnection" sc
JOIN "User" u ON u.id = sc."sharedWithUserId"
WHERE sc."connectionId" = $1
ORDER BY sc."createdAt" ASC
`, access.Connection.ID)
	if err != nil {
		return nil, fmt.Errorf("list shared connections: %w", err)
	}
	defer rows.Close()

	result := make([]shareListEntry, 0)
	for rows.Next() {
		var item shareListEntry
		if err := rows.Scan(&item.ID, &item.UserID, &item.Email, &item.Permission, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan shared connection: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate shared connections: %w", err)
	}
	return result, nil
}

func (s Service) resolveShareableConnection(ctx context.Context, userID, tenantID, connectionID string) (accessResult, error) {
	access, err := s.resolveAccess(ctx, userID, tenantID, connectionID)
	if err != nil {
		return accessResult{}, err
	}
	if access.AccessType == "shared" {
		return accessResult{}, pgx.ErrNoRows
	}
	if access.AccessType == "team" && (access.Connection.TeamRole == nil || *access.Connection.TeamRole != "TEAM_ADMIN") {
		return accessResult{}, &requestError{status: http.StatusForbidden, message: "Only team admins can manage team connection shares"}
	}
	return access, nil
}

func (s Service) resolveShareTargetUser(ctx context.Context, target shareTarget) (shareTargetUser, error) {
	target.Email = normalizeOptionalStringPtrValue(target.Email)
	target.UserID = normalizeOptionalStringPtrValue(target.UserID)
	if err := validateShareTarget(target); err != nil {
		return shareTargetUser{}, err
	}

	var user shareTargetUser
	if target.UserID != nil {
		if err := s.DB.QueryRow(ctx, `SELECT id, email FROM "User" WHERE id = $1`, *target.UserID).Scan(&user.ID, &user.Email); err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return shareTargetUser{}, &requestError{status: http.StatusNotFound, message: "User not found"}
			}
			return shareTargetUser{}, fmt.Errorf("load share target: %w", err)
		}
		return user, nil
	}
	if err := s.DB.QueryRow(ctx, `SELECT id, email FROM "User" WHERE LOWER(email) = LOWER($1)`, *target.Email).Scan(&user.ID, &user.Email); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return shareTargetUser{}, &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return shareTargetUser{}, fmt.Errorf("load share target: %w", err)
	}
	return user, nil
}

func (s Service) assertShareableTenantBoundary(ctx context.Context, actingUserID, targetUserID string) error {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_EXTERNAL_SHARING")), "true") {
		return nil
	}
	actingTenantIDs, err := s.loadAcceptedTenantIDs(ctx, actingUserID)
	if err != nil {
		return err
	}
	targetTenantIDs, err := s.loadAcceptedTenantIDs(ctx, targetUserID)
	if err != nil {
		return err
	}
	if len(actingTenantIDs) == 0 && len(targetTenantIDs) == 0 {
		return nil
	}
	for _, actingTenantID := range actingTenantIDs {
		for _, targetTenantID := range targetTenantIDs {
			if actingTenantID == targetTenantID {
				return nil
			}
		}
	}
	return &requestError{status: http.StatusForbidden, message: "Cannot share connections with users outside your tenant"}
}

func (s Service) loadAcceptedTenantIDs(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.DB.Query(ctx, `
SELECT "tenantId"
FROM "TenantMember"
WHERE "userId" = $1
  AND status = 'ACCEPTED'
  AND ("expiresAt" IS NULL OR "expiresAt" > NOW())
`, userID)
	if err != nil {
		return nil, fmt.Errorf("list tenant memberships: %w", err)
	}
	defer rows.Close()

	result := make([]string, 0)
	for rows.Next() {
		var tenantID string
		if err := rows.Scan(&tenantID); err != nil {
			return nil, fmt.Errorf("scan tenant membership: %w", err)
		}
		result = append(result, tenantID)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate tenant memberships: %w", err)
	}
	return result, nil
}

func (s Service) loadSharingSourceKey(ctx context.Context, userID string, connection connectionResponse) ([]byte, error) {
	if connection.TeamID == nil {
		key, err := s.getVaultKey(ctx, userID)
		if err != nil {
			return nil, err
		}
		if len(key) == 0 {
			return nil, &requestError{status: http.StatusForbidden, message: "Your vault is locked. Please unlock it first."}
		}
		return key, nil
	}
	return s.getTeamVaultKey(ctx, *connection.TeamID, userID)
}

func (s Service) getTeamVaultKey(ctx context.Context, teamID, userID string) ([]byte, error) {
	if s.Redis != nil && len(s.ServerEncryptionKey) > 0 {
		cacheKey := fmt.Sprintf("vault:team:%s:%s", teamID, userID)
		payload, err := s.Redis.Get(ctx, cacheKey).Bytes()
		if err == nil {
			var field encryptedField
			if normalized, decodeErr := rediscompat.DecodeJSONPayload(payload, &field); decodeErr == nil {
				hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
				if err == nil {
					teamKey, err := hex.DecodeString(hexKey)
					if err == nil {
						if pttl, ttlErr := s.Redis.PTTL(ctx, cacheKey).Result(); ttlErr == nil && pttl > 0 {
							_ = s.Redis.Set(ctx, cacheKey, normalized, pttl).Err()
						}
						return teamKey, nil
					}
				}
			}
		} else if !errors.Is(err, redis.Nil) {
			return nil, fmt.Errorf("load team vault session: %w", err)
		}
	}

	actingMasterKey, err := s.getVaultKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(actingMasterKey) == 0 {
		return nil, &requestError{status: http.StatusForbidden, message: "Your vault is locked. Please unlock it first."}
	}
	defer zeroBytes(actingMasterKey)

	var field encryptedField
	if err := s.DB.QueryRow(ctx, `
SELECT "encryptedTeamVaultKey", "teamVaultKeyIV", "teamVaultKeyTag"
FROM "TeamMember"
WHERE "teamId" = $1 AND "userId" = $2
`, teamID, userID).Scan(&field.Ciphertext, &field.IV, &field.Tag); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, pgx.ErrNoRows
		}
		return nil, fmt.Errorf("load acting member team key: %w", err)
	}
	if strings.TrimSpace(field.Ciphertext) == "" || strings.TrimSpace(field.IV) == "" || strings.TrimSpace(field.Tag) == "" {
		return nil, &requestError{status: http.StatusInternalServerError, message: "Unable to access team vault key"}
	}

	hexKey, err := decryptEncryptedField(actingMasterKey, field)
	if err != nil {
		return nil, &requestError{status: http.StatusInternalServerError, message: "Unable to access team vault key"}
	}
	teamKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode team key: %w", err)
	}
	return teamKey, nil
}

func (s Service) loadSharableCredentials(ctx context.Context, connectionID string) (sourceCredentials, error) {
	var fields struct {
		UsernameCiphertext sql.NullString
		UsernameIV         sql.NullString
		UsernameTag        sql.NullString
		PasswordCiphertext sql.NullString
		PasswordIV         sql.NullString
		PasswordTag        sql.NullString
		DomainCiphertext   sql.NullString
		DomainIV           sql.NullString
		DomainTag          sql.NullString
	}
	if err := s.DB.QueryRow(ctx, `
SELECT
	"encryptedUsername",
	"usernameIV",
	"usernameTag",
	"encryptedPassword",
	"passwordIV",
	"passwordTag",
	"encryptedDomain",
	"domainIV",
	"domainTag"
FROM "Connection"
WHERE id = $1
`, connectionID).Scan(
		&fields.UsernameCiphertext,
		&fields.UsernameIV,
		&fields.UsernameTag,
		&fields.PasswordCiphertext,
		&fields.PasswordIV,
		&fields.PasswordTag,
		&fields.DomainCiphertext,
		&fields.DomainIV,
		&fields.DomainTag,
	); err != nil {
		return sourceCredentials{}, fmt.Errorf("load connection credentials: %w", err)
	}
	if !fields.UsernameCiphertext.Valid || !fields.UsernameIV.Valid || !fields.UsernameTag.Valid ||
		!fields.PasswordCiphertext.Valid || !fields.PasswordIV.Valid || !fields.PasswordTag.Valid {
		return sourceCredentials{}, &requestError{status: http.StatusBadRequest, message: "Connection has no credentials to share"}
	}

	result := sourceCredentials{
		Username: encryptedField{
			Ciphertext: fields.UsernameCiphertext.String,
			IV:         fields.UsernameIV.String,
			Tag:        fields.UsernameTag.String,
		},
		Password: encryptedField{
			Ciphertext: fields.PasswordCiphertext.String,
			IV:         fields.PasswordIV.String,
			Tag:        fields.PasswordTag.String,
		},
	}
	if fields.DomainCiphertext.Valid && fields.DomainIV.Valid && fields.DomainTag.Valid {
		result.Domain = &encryptedField{
			Ciphertext: fields.DomainCiphertext.String,
			IV:         fields.DomainIV.String,
			Tag:        fields.DomainTag.String,
		}
	}
	return result, nil
}

func reencryptSharedCredentials(sourceKey, targetKey []byte, creds sourceCredentials) (encryptedField, encryptedField, *encryptedField, error) {
	username, err := decryptEncryptedField(sourceKey, creds.Username)
	if err != nil {
		return encryptedField{}, encryptedField{}, nil, &requestError{status: http.StatusBadRequest, message: "Connection has no credentials to share"}
	}
	password, err := decryptEncryptedField(sourceKey, creds.Password)
	if err != nil {
		return encryptedField{}, encryptedField{}, nil, &requestError{status: http.StatusBadRequest, message: "Connection has no credentials to share"}
	}

	encUsername, err := encryptValue(targetKey, username)
	if err != nil {
		return encryptedField{}, encryptedField{}, nil, err
	}
	encPassword, err := encryptValue(targetKey, password)
	if err != nil {
		return encryptedField{}, encryptedField{}, nil, err
	}

	var encDomain *encryptedField
	if creds.Domain != nil {
		domain, err := decryptEncryptedField(sourceKey, *creds.Domain)
		if err == nil && strings.TrimSpace(domain) != "" {
			field, err := encryptValue(targetKey, domain)
			if err != nil {
				return encryptedField{}, encryptedField{}, nil, err
			}
			encDomain = &field
		}
	}
	return encUsername, encPassword, encDomain, nil
}

func (s Service) lookupActorName(ctx context.Context, userID string) (string, error) {
	var actorName string
	if err := s.DB.QueryRow(ctx, `SELECT COALESCE(NULLIF(username, ''), email, 'Someone') FROM "User" WHERE id = $1`, userID).Scan(&actorName); err != nil {
		return "", fmt.Errorf("load actor identity: %w", err)
	}
	return actorName, nil
}

func (s Service) insertNotification(ctx context.Context, userID, notificationType, message, relatedID string) error {
	_, err := s.DB.Exec(ctx, `
INSERT INTO "Notification" (id, "userId", type, message, read, "relatedId", "createdAt")
VALUES ($1, $2, $3::"NotificationType", $4, false, NULLIF($5, ''), NOW())
`, uuid.NewString(), userID, notificationType, message, relatedID)
	if err != nil {
		return fmt.Errorf("insert notification: %w", err)
	}
	return nil
}
