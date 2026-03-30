package tenants

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/bcrypt"
)

const tenantVerificationSessionKeyPrefix = "identity:verification:"

type adminChangeEmailPayload struct {
	NewEmail       string `json:"newEmail"`
	VerificationID string `json:"verificationId"`
}

type adminChangePasswordPayload struct {
	NewPassword    string `json:"newPassword"`
	VerificationID string `json:"verificationId"`
}

type tenantVerificationSession struct {
	UserID    string `json:"userId"`
	Purpose   string `json:"purpose"`
	Confirmed bool   `json:"confirmed"`
	ExpiresAt int64  `json:"expiresAt"`
}

type adminChangedUserResponse struct {
	ID       string  `json:"id"`
	Email    string  `json:"email"`
	Username *string `json:"username,omitempty"`
}

type adminPasswordChangeResponse struct {
	RecoveryKey string `json:"recoveryKey"`
}

func (s Service) HandleAdminChangeUserEmail(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireOwnTenant(claims, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.requireManageUsersPermission(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload adminChangeEmailPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.AdminChangeUserEmail(r.Context(), claims.TenantID, claims.UserID, r.PathValue("userId"), payload.NewEmail, payload.VerificationID, requestIP(r))
	if err != nil {
		var reqErr *requestError
		if errorsAsRequestError(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleAdminChangeUserPassword(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireOwnTenant(claims, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.requireManageUsersPermission(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload adminChangePasswordPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.AdminChangeUserPassword(r.Context(), claims.TenantID, claims.UserID, r.PathValue("userId"), payload.NewPassword, payload.VerificationID, requestIP(r))
	if err != nil {
		var reqErr *requestError
		if errorsAsRequestError(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) AdminChangeUserEmail(ctx context.Context, tenantID, actingUserID, targetUserID, newEmail, verificationID, ipAddress string) (adminChangedUserResponse, error) {
	if s.DB == nil {
		return adminChangedUserResponse{}, fmt.Errorf("database is unavailable")
	}
	newEmail = strings.TrimSpace(strings.ToLower(newEmail))
	if !looksLikeEmail(newEmail) {
		return adminChangedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "newEmail must be a valid email"}
	}
	if err := s.consumeVerificationSession(ctx, verificationID, actingUserID, "admin-action"); err != nil {
		return adminChangedUserResponse{}, err
	}
	if err := s.requireAdminOrOwnerMembership(ctx, tenantID, actingUserID); err != nil {
		return adminChangedUserResponse{}, err
	}

	var (
		currentEmail string
		usernameRaw  sql.NullString
	)
	if err := s.DB.QueryRow(ctx, `
SELECT u.email, u.username
FROM "TenantMember" tm
JOIN "User" u ON u.id = tm."userId"
WHERE tm."tenantId" = $1 AND tm."userId" = $2
`, tenantID, targetUserID).Scan(&currentEmail, &usernameRaw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return adminChangedUserResponse{}, &requestError{status: http.StatusNotFound, message: "User not found in this organization"}
		}
		return adminChangedUserResponse{}, fmt.Errorf("load target user membership: %w", err)
	}

	var existingUserID string
	err := s.DB.QueryRow(ctx, `SELECT id FROM "User" WHERE email = $1`, newEmail).Scan(&existingUserID)
	switch {
	case err == nil && existingUserID != targetUserID:
		return adminChangedUserResponse{}, &requestError{status: http.StatusConflict, message: "Email already in use"}
	case err != nil && !errors.Is(err, pgx.ErrNoRows):
		return adminChangedUserResponse{}, fmt.Errorf("check duplicate email: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return adminChangedUserResponse{}, fmt.Errorf("begin admin email change: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var result adminChangedUserResponse
	if err := tx.QueryRow(ctx, `
UPDATE "User"
SET email = $2,
    "emailVerified" = false,
    "updatedAt" = NOW()
WHERE id = $1
RETURNING id, email, username
`, targetUserID, newEmail).Scan(&result.ID, &result.Email, &result.Username); err != nil {
		return adminChangedUserResponse{}, fmt.Errorf("update user email: %w", err)
	}

	if err := insertTenantAuditLog(ctx, tx, actingUserID, "ADMIN_EMAIL_CHANGE", "User", targetUserID, map[string]any{
		"oldEmail": currentEmail,
		"newEmail": newEmail,
	}, ipAddress); err != nil {
		return adminChangedUserResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return adminChangedUserResponse{}, fmt.Errorf("commit admin email change: %w", err)
	}

	return result, nil
}

func (s Service) AdminChangeUserPassword(ctx context.Context, tenantID, actingUserID, targetUserID, newPassword, verificationID, ipAddress string) (adminPasswordChangeResponse, error) {
	if s.DB == nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("database is unavailable")
	}
	if err := validateManagedUserPassword(newPassword); err != nil {
		return adminPasswordChangeResponse{}, err
	}
	if err := s.consumeVerificationSession(ctx, verificationID, actingUserID, "admin-action"); err != nil {
		return adminPasswordChangeResponse{}, err
	}
	if err := s.requireAdminOrOwnerMembership(ctx, tenantID, actingUserID); err != nil {
		return adminPasswordChangeResponse{}, err
	}

	var targetMembershipID string
	if err := s.DB.QueryRow(ctx, `SELECT id FROM "TenantMember" WHERE "tenantId" = $1 AND "userId" = $2`, tenantID, targetUserID).Scan(&targetMembershipID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return adminPasswordChangeResponse{}, &requestError{status: http.StatusNotFound, message: "User not found in this organization"}
		}
		return adminPasswordChangeResponse{}, fmt.Errorf("load target membership: %w", err)
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(newPassword), managedUserBcryptRounds)
	if err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("hash password: %w", err)
	}

	newMasterKey := generateTenantMasterKey()
	defer zeroTenantBytes(newMasterKey)
	newVaultSalt := generateTenantSalt()
	newDerivedKey := deriveTenantKeyFromPassword(newPassword, newVaultSalt)
	if len(newDerivedKey) == 0 {
		return adminPasswordChangeResponse{}, fmt.Errorf("derive vault key: invalid salt")
	}
	defer zeroTenantBytes(newDerivedKey)

	newEncryptedVault, err := encryptTenantMasterKey(newMasterKey, newDerivedKey)
	if err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("encrypt vault key: %w", err)
	}

	recoveryKey, err := generateTenantRecoveryKey()
	if err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("generate recovery key: %w", err)
	}
	recoverySalt := generateTenantSalt()
	recoveryDerivedKey := deriveTenantKeyFromPassword(recoveryKey, recoverySalt)
	if len(recoveryDerivedKey) == 0 {
		return adminPasswordChangeResponse{}, fmt.Errorf("derive recovery key: invalid salt")
	}
	defer zeroTenantBytes(recoveryDerivedKey)

	recoveryEncrypted, err := encryptTenantMasterKey(newMasterKey, recoveryDerivedKey)
	if err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("encrypt recovery key: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("begin admin password change: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
UPDATE "User"
SET "passwordHash" = $2,
    "vaultSalt" = $3,
    "encryptedVaultKey" = $4,
    "vaultKeyIV" = $5,
    "vaultKeyTag" = $6,
    "encryptedVaultRecoveryKey" = $7,
    "vaultRecoveryKeyIV" = $8,
    "vaultRecoveryKeyTag" = $9,
    "vaultRecoveryKeySalt" = $10,
    "totpEnabled" = false,
    "totpSecret" = NULL,
    "encryptedTotpSecret" = NULL,
    "totpSecretIV" = NULL,
    "totpSecretTag" = NULL,
    "encryptedDomainPassword" = NULL,
    "domainPasswordIV" = NULL,
    "domainPasswordTag" = NULL,
    "updatedAt" = NOW()
WHERE id = $1
`, targetUserID,
		string(passwordHash),
		newVaultSalt,
		newEncryptedVault.Ciphertext,
		newEncryptedVault.IV,
		newEncryptedVault.Tag,
		recoveryEncrypted.Ciphertext,
		recoveryEncrypted.IV,
		recoveryEncrypted.Tag,
		recoverySalt,
	); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("update user password: %w", err)
	}

	if _, err := tx.Exec(ctx, `
UPDATE "Connection"
SET "encryptedUsername" = NULL,
    "usernameIV" = NULL,
    "usernameTag" = NULL,
    "encryptedPassword" = NULL,
    "passwordIV" = NULL,
    "passwordTag" = NULL,
    "encryptedDomain" = NULL,
    "domainIV" = NULL,
    "domainTag" = NULL,
    "updatedAt" = NOW()
WHERE "userId" = $1
`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("wipe owned connection credentials: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "SharedConnection" WHERE "sharedByUserId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete shared connections: %w", err)
	}
	if _, err := tx.Exec(ctx, `
UPDATE "SharedConnection"
SET "encryptedUsername" = NULL,
    "usernameIV" = NULL,
    "usernameTag" = NULL,
    "encryptedPassword" = NULL,
    "passwordIV" = NULL,
    "passwordTag" = NULL,
    "encryptedDomain" = NULL,
    "domainIV" = NULL,
    "domainTag" = NULL
WHERE "sharedWithUserId" = $1
`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("wipe received shared connection credentials: %w", err)
	}

	if _, err := tx.Exec(ctx, `
UPDATE "TeamMember"
SET "encryptedTeamVaultKey" = NULL,
    "teamVaultKeyIV" = NULL,
    "teamVaultKeyTag" = NULL
WHERE "userId" = $1
`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("wipe team vault keys: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "TenantVaultMember" WHERE "userId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete tenant vault memberships: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "SharedSecret" WHERE "sharedByUserId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete shared secrets by user: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "SharedSecret" WHERE "sharedWithUserId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete shared secrets with user: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "ExternalSecretShare" WHERE "secretId" IN (SELECT id FROM "VaultSecret" WHERE "userId" = $1)`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete external secret shares: %w", err)
	}
	if _, err := tx.Exec(ctx, `DELETE FROM "VaultSecret" WHERE "userId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete owned secrets: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "userId" = $1`, targetUserID); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("delete refresh tokens: %w", err)
	}

	if err := insertTenantAuditLog(ctx, tx, actingUserID, "ADMIN_PASSWORD_CHANGE", "User", targetUserID, map[string]any{
		"vaultReset": true,
	}, ipAddress); err != nil {
		return adminPasswordChangeResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return adminPasswordChangeResponse{}, fmt.Errorf("commit admin password change: %w", err)
	}

	if s.Redis != nil {
		_ = s.Redis.Del(ctx, "vault:user:"+targetUserID, "vault:recovery:"+targetUserID).Err()
	}

	return adminPasswordChangeResponse{RecoveryKey: recoveryKey}, nil
}

func (s Service) requireAdminOrOwnerMembership(ctx context.Context, tenantID, actingUserID string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}

	var role string
	if err := s.DB.QueryRow(ctx, `SELECT role::text FROM "TenantMember" WHERE "tenantId" = $1 AND "userId" = $2`, tenantID, actingUserID).Scan(&role); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusForbidden, message: "Insufficient permissions"}
		}
		return fmt.Errorf("load acting membership: %w", err)
	}
	role = strings.ToUpper(strings.TrimSpace(role))
	if role != "ADMIN" && role != "OWNER" {
		return &requestError{status: http.StatusForbidden, message: "Insufficient permissions"}
	}
	return nil
}

func (s Service) consumeVerificationSession(ctx context.Context, verificationID, userID, purpose string) error {
	if s.Redis == nil {
		return fmt.Errorf("redis is not configured")
	}
	verificationID = strings.TrimSpace(verificationID)
	if verificationID == "" {
		return &requestError{status: http.StatusBadRequest, message: "verificationId is required"}
	}

	value, err := s.Redis.Get(ctx, tenantVerificationSessionKeyPrefix+verificationID).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return &requestError{status: http.StatusBadRequest, message: "Verification session not found."}
		}
		return fmt.Errorf("load verification session: %w", err)
	}

	payload, err := base64.StdEncoding.DecodeString(value)
	if err != nil {
		return fmt.Errorf("decode verification session: %w", err)
	}

	var session tenantVerificationSession
	if err := json.Unmarshal(payload, &session); err != nil {
		return fmt.Errorf("unmarshal verification session: %w", err)
	}

	if !session.Confirmed {
		return &requestError{status: http.StatusBadRequest, message: "Verification not yet confirmed."}
	}
	if session.UserID != userID {
		return &requestError{status: http.StatusForbidden, message: "Verification session mismatch."}
	}
	if session.Purpose != purpose {
		return &requestError{status: http.StatusForbidden, message: "Verification purpose mismatch."}
	}
	if session.ExpiresAt < time.Now().UnixMilli() {
		_ = s.Redis.Del(ctx, tenantVerificationSessionKeyPrefix+verificationID).Err()
		return &requestError{status: http.StatusBadRequest, message: "Verification expired. Please start a new verification."}
	}
	if err := s.Redis.Del(ctx, tenantVerificationSessionKeyPrefix+verificationID).Err(); err != nil {
		return fmt.Errorf("delete verification session: %w", err)
	}
	return nil
}

func insertTenantAuditLog(ctx context.Context, tx pgx.Tx, userID, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	if details == nil {
		details = map[string]any{}
	}
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	var ipValue any
	if strings.TrimSpace(ipAddress) != "" {
		ipValue = strings.TrimSpace(ipAddress)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress")
VALUES ($1, $2, $3::"AuditAction", $4, $5, $6::jsonb, $7)
`, uuid.NewString(), userID, action, targetType, targetID, string(rawDetails), ipValue); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func requestIP(r *http.Request) string {
	if r == nil {
		return ""
	}
	if forwarded := strings.TrimSpace(r.Header.Get("x-forwarded-for")); forwarded != "" {
		return strings.TrimSpace(strings.Split(forwarded, ",")[0])
	}
	if realIP := strings.TrimSpace(r.Header.Get("x-real-ip")); realIP != "" {
		return realIP
	}
	host, _, err := netSplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func netSplitHostPort(addr string) (string, string, error) {
	if strings.Count(addr, ":") > 1 && !strings.Contains(addr, "]") {
		return addr, "", nil
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr, "", err
	}
	return host, port, nil
}
