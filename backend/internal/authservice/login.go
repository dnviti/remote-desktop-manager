package authservice

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/http"
	"os"
	"sort"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func (s Service) Logout(ctx context.Context, refreshToken, ipAddress string) (string, error) {
	if s.DB == nil || refreshToken == "" {
		return "", nil
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("begin logout: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var (
		userID      *string
		tokenFamily *string
	)
	err = tx.QueryRow(ctx, `SELECT "userId", "tokenFamily" FROM "RefreshToken" WHERE token = $1`, refreshToken).Scan(&userID, &tokenFamily)
	if err != nil && err != pgx.ErrNoRows {
		return "", fmt.Errorf("load refresh token: %w", err)
	}
	if tokenFamily != nil && *tokenFamily != "" {
		if _, err := tx.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "tokenFamily" = $1`, *tokenFamily); err != nil {
			return "", fmt.Errorf("delete refresh token family: %w", err)
		}
	} else if _, err := tx.Exec(ctx, `DELETE FROM "RefreshToken" WHERE token = $1`, refreshToken); err != nil {
		return "", fmt.Errorf("delete refresh token: %w", err)
	}

	if userID != nil && *userID != "" {
		if err := insertAuditLog(ctx, tx, userID, "LOGOUT", map[string]any{}, ipAddress); err != nil {
			return "", err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit logout: %w", err)
	}

	if userID == nil {
		return "", nil
	}
	return *userID, nil
}

func (s Service) Refresh(ctx context.Context, refreshToken, ipAddress, userAgent string) (issuedLogin, error) {
	if s.DB == nil {
		return issuedLogin{}, fmt.Errorf("postgres is not configured")
	}
	if refreshToken == "" {
		return issuedLogin{}, &requestError{status: 401, message: "Missing refresh token"}
	}

	type storedRefreshToken struct {
		ID              string
		UserID          string
		TokenFamily     string
		FamilyCreatedAt time.Time
		IPUAHash        *string
		RevokedAt       *time.Time
		ExpiresAt       time.Time
		UserEnabled     bool
	}

	var stored storedRefreshToken
	err := s.DB.QueryRow(
		ctx,
		`SELECT rt.id, rt."userId", rt."tokenFamily", rt."familyCreatedAt", rt."ipUaHash", rt."revokedAt", rt."expiresAt", u.enabled
		   FROM "RefreshToken" rt
		   JOIN "User" u ON u.id = rt."userId"
		  WHERE rt.token = $1`,
		refreshToken,
	).Scan(
		&stored.ID,
		&stored.UserID,
		&stored.TokenFamily,
		&stored.FamilyCreatedAt,
		&stored.IPUAHash,
		&stored.RevokedAt,
		&stored.ExpiresAt,
		&stored.UserEnabled,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
		}
		return issuedLogin{}, fmt.Errorf("load refresh token: %w", err)
	}

	if s.TokenBinding && stored.IPUAHash != nil && *stored.IPUAHash != "" {
		if computeBindingHash(ipAddress, userAgent) != *stored.IPUAHash {
			_, _ = s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "tokenFamily" = $1`, stored.TokenFamily)
			_ = s.insertStandaloneAuditLog(ctx, &stored.UserID, "TOKEN_HIJACK_ATTEMPT", map[string]any{
				"tokenFamily": stored.TokenFamily,
				"reason":      "Refresh token presented from different IP/User-Agent",
			}, ipAddress)
			return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
		}
	}

	if stored.RevokedAt != nil {
		_, _ = s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "tokenFamily" = $1`, stored.TokenFamily)
		_ = s.insertStandaloneAuditLog(ctx, &stored.UserID, "REFRESH_TOKEN_REUSE", map[string]any{
			"tokenFamily": stored.TokenFamily,
			"reason":      "Rotated refresh token reused — all family tokens revoked",
		}, ipAddress)
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
	}

	if stored.ExpiresAt.Before(time.Now()) {
		_, _ = s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE id = $1`, stored.ID)
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
	}

	if !stored.UserEnabled {
		_, _ = s.DB.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "tokenFamily" = $1`, stored.TokenFamily)
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
	}

	user, err := s.loadLoginUserByID(ctx, stored.UserID)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired refresh token"}
		}
		return issuedLogin{}, err
	}

	if _, err := s.DB.Exec(ctx, `UPDATE "RefreshToken" SET "revokedAt" = NOW() WHERE id = $1`, stored.ID); err != nil {
		return issuedLogin{}, fmt.Errorf("revoke refresh token: %w", err)
	}

	return s.issueTokensForFamily(ctx, user, ipAddress, userAgent, stored.TokenFamily, stored.FamilyCreatedAt)
}

func (s Service) Login(ctx context.Context, email, password, ipAddress, userAgent string) (loginFlow, error) {
	if s.DB == nil {
		return loginFlow{}, fmt.Errorf("postgres is not configured")
	}
	if len(s.JWTSecret) == 0 {
		return loginFlow{}, fmt.Errorf("JWT secret is not configured")
	}
	if os.Getenv("LDAP_ENABLED") == "true" {
		return loginFlow{}, ErrLegacyLogin
	}
	if email == "" || password == "" {
		return loginFlow{}, &requestError{status: 400, message: "Email and password are required"}
	}
	if err := s.enforceLoginRateLimit(ctx, ipAddress); err != nil {
		return loginFlow{}, err
	}

	user, err := s.loadLoginUser(ctx, email)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			_ = s.insertStandaloneAuditLog(ctx, nil, "LOGIN_FAILURE", map[string]any{
				"reason": "user_not_found",
				"email":  email,
			}, ipAddress)
			return loginFlow{}, &requestError{status: 401, message: "Invalid email or password"}
		}
		return loginFlow{}, err
	}

	if !user.Enabled {
		_ = s.insertStandaloneAuditLog(ctx, &user.ID, "LOGIN_FAILURE", map[string]any{
			"reason": "account_disabled",
			"email":  email,
		}, ipAddress)
		return loginFlow{}, &requestError{status: 403, message: "Your account has been disabled. Contact your administrator."}
	}

	effectiveThreshold := s.effectiveLockoutThreshold(user.ActiveTenant)
	effectiveDuration := s.effectiveLockoutDuration(user.ActiveTenant)

	if user.LockedUntil != nil && user.LockedUntil.After(time.Now()) {
		remainingMin := int(time.Until(*user.LockedUntil).Round(time.Minute).Minutes())
		if remainingMin < 1 {
			remainingMin = 1
		}
		_ = s.insertStandaloneAuditLog(ctx, &user.ID, "LOGIN_FAILURE", map[string]any{
			"reason": "account_locked",
			"email":  email,
		}, ipAddress)
		return loginFlow{}, &requestError{status: http.StatusLocked, message: fmt.Sprintf("Account is temporarily locked. Try again in %d minute%s.", remainingMin, plural(remainingMin))}
	}

	if user.PasswordHash == nil || *user.PasswordHash == "" {
		_ = s.insertStandaloneAuditLog(ctx, &user.ID, "LOGIN_FAILURE", map[string]any{
			"reason": "oauth_only_account",
			"email":  email,
		}, ipAddress)
		return loginFlow{}, &requestError{status: 400, message: "This account uses social login. Please sign in with your OAuth provider."}
	}

	if err := bcrypt.CompareHashAndPassword([]byte(*user.PasswordHash), []byte(password)); err != nil {
		if err := s.recordInvalidPassword(ctx, user.ID, email, ipAddress, user.FailedLoginAttempts, effectiveThreshold, effectiveDuration); err != nil {
			return loginFlow{}, err
		}
		return loginFlow{}, &requestError{status: 401, message: "Invalid email or password"}
	}

	if s.EmailVerify && !user.EmailVerified {
		_ = s.insertStandaloneAuditLog(ctx, &user.ID, "LOGIN_FAILURE", map[string]any{
			"reason": "email_not_verified",
			"email":  email,
		}, ipAddress)
		return loginFlow{}, &requestError{status: 403, message: "Email not verified. Please check your inbox or resend the verification email."}
	}

	if user.ActiveTenant != nil && user.ActiveTenant.IPAllowlistEnabled {
		return loginFlow{}, ErrLegacyLogin
	}

	if err := s.resetLoginCounters(ctx, user.ID, user.FailedLoginAttempts, user.LockedUntil); err != nil {
		return loginFlow{}, err
	}

	if err := s.storeVaultSession(ctx, user.ID, password, user); err != nil {
		return loginFlow{}, err
	}

	mfaMethods := make([]string, 0, 2)
	if user.TOTPEnabled {
		mfaMethods = append(mfaMethods, "totp")
	}
	if user.SMSMFAEnabled {
		mfaMethods = append(mfaMethods, "sms")
	}
	if user.WebAuthnEnabled {
		mfaMethods = append(mfaMethods, "webauthn")
	}
	if len(mfaMethods) > 0 {
		tempToken, err := s.issueTempToken(user.ID, "mfa-verify", 5*time.Minute)
		if err != nil {
			return loginFlow{}, err
		}
		return loginFlow{
			requiresMFA:  true,
			requiresTOTP: user.TOTPEnabled,
			methods:      mfaMethods,
			tempToken:    tempToken,
		}, nil
	}

	if user.ActiveTenant != nil && user.ActiveTenant.MFARequired {
		tempToken, err := s.issueTempToken(user.ID, "mfa-setup", 15*time.Minute)
		if err != nil {
			return loginFlow{}, err
		}
		return loginFlow{
			mfaSetupRequired: true,
			tempToken:        tempToken,
		}, nil
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return loginFlow{}, err
	}

	_ = s.insertStandaloneAuditLog(ctx, &user.ID, "LOGIN", map[string]any{}, ipAddress)
	return loginFlow{issued: &result}, nil
}

func (s Service) SwitchTenant(ctx context.Context, userID, targetTenantID, ipAddress, userAgent string) (issuedLogin, error) {
	if s.DB == nil {
		return issuedLogin{}, fmt.Errorf("postgres is not configured")
	}
	if targetTenantID == "" {
		return issuedLogin{}, &requestError{status: 400, message: "tenantId is required"}
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return issuedLogin{}, fmt.Errorf("begin tenant switch: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var expiresAt sql.NullTime
	if err := tx.QueryRow(ctx, `
SELECT "expiresAt"
FROM "TenantMember"
WHERE "tenantId" = $1 AND "userId" = $2
`, targetTenantID, userID).Scan(&expiresAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return issuedLogin{}, &requestError{status: 403, message: "You are not a member of this organization"}
		}
		return issuedLogin{}, fmt.Errorf("load tenant membership: %w", err)
	}
	if expiresAt.Valid && !expiresAt.Time.After(time.Now()) {
		return issuedLogin{}, &requestError{status: 403, message: "Your membership in this organization has expired"}
	}

	if _, err := tx.Exec(ctx, `
UPDATE "TenantMember"
SET "isActive" = false
WHERE "userId" = $1 AND "isActive" = true
`, userID); err != nil {
		return issuedLogin{}, fmt.Errorf("deactivate active memberships: %w", err)
	}

	if _, err := tx.Exec(ctx, `
UPDATE "TenantMember"
SET status = 'ACCEPTED', "isActive" = true
WHERE "tenantId" = $1 AND "userId" = $2
`, targetTenantID, userID); err != nil {
		return issuedLogin{}, fmt.Errorf("activate target membership: %w", err)
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "RefreshToken" WHERE "userId" = $1`, userID); err != nil {
		return issuedLogin{}, fmt.Errorf("delete refresh tokens: %w", err)
	}

	if err := insertAuditLog(ctx, tx, &userID, "TENANT_SWITCH", map[string]any{
		"targetTenantId": targetTenantID,
	}, ipAddress); err != nil {
		return issuedLogin{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return issuedLogin{}, fmt.Errorf("commit tenant switch: %w", err)
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return issuedLogin{}, err
	}
	return s.issueTokens(ctx, user, ipAddress, userAgent)
}

func (s Service) IssueDeviceAuthTokens(ctx context.Context, userID, ipAddress, userAgent string) (map[string]any, time.Duration, error) {
	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return nil, 0, err
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return nil, 0, err
	}

	return map[string]any{
		"access_token":  result.accessToken,
		"refresh_token": result.refreshToken,
		"token_type":    "Bearer",
		"user":          result.user,
	}, result.refreshExpires, nil
}

func (s Service) loadLoginUser(ctx context.Context, email string) (loginUser, error) {
	return s.loadLoginUserByIDOrEmail(ctx, "email", email)
}

func (s Service) loadLoginUserByID(ctx context.Context, userID string) (loginUser, error) {
	return s.loadLoginUserByIDOrEmail(ctx, "id", userID)
}

func (s Service) loadLoginUserByIDOrEmail(ctx context.Context, field, value string) (loginUser, error) {
	var user loginUser
	query := `SELECT id, email, username, "avatarData", "passwordHash", "vaultSalt", "encryptedVaultKey", "vaultKeyIV", "vaultKeyTag",
		        enabled, "emailVerified", "totpEnabled", "smsMfaEnabled", "webauthnEnabled", "failedLoginAttempts", "lockedUntil"
		   FROM "User"
		  WHERE email = $1`
	if field == "id" {
		query = `SELECT id, email, username, "avatarData", "passwordHash", "vaultSalt", "encryptedVaultKey", "vaultKeyIV", "vaultKeyTag",
		        enabled, "emailVerified", "totpEnabled", "smsMfaEnabled", "webauthnEnabled", "failedLoginAttempts", "lockedUntil"
		   FROM "User"
		  WHERE id = $1`
	}
	err := s.DB.QueryRow(ctx, query, value).Scan(
		&user.ID, &user.Email, &user.Username, &user.AvatarData, &user.PasswordHash, &user.VaultSalt,
		&user.EncryptedVaultKey, &user.VaultKeyIV, &user.VaultKeyTag, &user.Enabled, &user.EmailVerified,
		&user.TOTPEnabled, &user.SMSMFAEnabled, &user.WebAuthnEnabled, &user.FailedLoginAttempts, &user.LockedUntil,
	)
	if err != nil {
		return loginUser{}, err
	}

	rows, err := s.DB.Query(
		ctx,
		`SELECT tm."tenantId", t.name, t.slug, tm.role::text, tm.status::text, tm."isActive", tm."joinedAt",
		        t."mfaRequired", t."ipAllowlistEnabled", t."jwtExpiresInSeconds", t."jwtRefreshExpiresInSeconds",
		        t."accountLockoutThreshold", t."accountLockoutDurationMs"
		   FROM "TenantMember" tm
		   JOIN "Tenant" t ON t.id = tm."tenantId"
		  WHERE tm."userId" = $1
		    AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
		  ORDER BY tm."joinedAt" ASC`,
		user.ID,
	)
	if err != nil {
		return loginUser{}, fmt.Errorf("query memberships: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		var membership loginMembership
		if err := rows.Scan(
			&membership.TenantID, &membership.Name, &membership.Slug, &membership.Role, &membership.Status, &membership.IsActive,
			&membership.JoinedAt, &membership.MFARequired, &membership.IPAllowlistEnabled, &membership.JWTExpiresInSeconds,
			&membership.JWTRefreshExpiresSeconds, &membership.AccountLockoutThreshold, &membership.AccountLockoutDurationMs,
		); err != nil {
			return loginUser{}, fmt.Errorf("scan membership: %w", err)
		}
		user.Memberships = append(user.Memberships, membership)
	}
	if err := rows.Err(); err != nil {
		return loginUser{}, fmt.Errorf("iterate memberships: %w", err)
	}

	accepted := make([]loginMembership, 0)
	for _, membership := range user.Memberships {
		if membership.Status == "ACCEPTED" {
			accepted = append(accepted, membership)
		}
		if membership.IsActive && membership.Status == "ACCEPTED" {
			copyMembership := membership
			user.ActiveTenant = &copyMembership
		}
	}

	if user.ActiveTenant == nil && len(accepted) == 1 {
		if _, err := s.DB.Exec(ctx, `UPDATE "TenantMember" SET "isActive" = true WHERE "tenantId" = $1 AND "userId" = $2`, accepted[0].TenantID, user.ID); err != nil {
			return loginUser{}, fmt.Errorf("activate tenant membership: %w", err)
		}
		accepted[0].IsActive = true
		user.ActiveTenant = &accepted[0]
		for i := range user.Memberships {
			if user.Memberships[i].TenantID == accepted[0].TenantID {
				user.Memberships[i].IsActive = true
			}
		}
	}

	user.HasLegacyOrAdvancedAuth = user.WebAuthnEnabled
	return user, nil
}

func (s Service) effectiveLockoutThreshold(active *loginMembership) int {
	if active != nil && active.AccountLockoutThreshold != nil {
		return *active.AccountLockoutThreshold
	}
	if value := os.Getenv("ACCOUNT_LOCKOUT_THRESHOLD"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return parsed
		}
	}
	return 10
}

func (s Service) effectiveLockoutDuration(active *loginMembership) time.Duration {
	if active != nil && active.AccountLockoutDurationMs != nil {
		return time.Duration(*active.AccountLockoutDurationMs) * time.Millisecond
	}
	if value := os.Getenv("ACCOUNT_LOCKOUT_DURATION_MS"); value != "" {
		if parsed, err := strconv.Atoi(value); err == nil {
			return time.Duration(parsed) * time.Millisecond
		}
	}
	return 30 * time.Minute
}

func (s Service) recordInvalidPassword(ctx context.Context, userID, email, ipAddress string, failedAttempts, threshold int, duration time.Duration) error {
	newAttempts := failedAttempts + 1
	var lockedUntil any = nil
	var storedAttempts = newAttempts
	accountLocked := false
	if newAttempts >= threshold {
		lockTime := time.Now().Add(duration)
		lockedUntil = lockTime
		storedAttempts = 0
		accountLocked = true
	}

	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "failedLoginAttempts" = $2,
		        "lockedUntil" = $3
		  WHERE id = $1`,
		userID,
		storedAttempts,
		lockedUntil,
	); err != nil {
		return fmt.Errorf("update failed login attempts: %w", err)
	}

	return s.insertStandaloneAuditLog(ctx, &userID, "LOGIN_FAILURE", map[string]any{
		"reason":         "invalid_password",
		"email":          email,
		"failedAttempts": newAttempts,
		"accountLocked":  accountLocked,
	}, ipAddress)
}

func (s Service) resetLoginCounters(ctx context.Context, userID string, failedAttempts int, lockedUntil *time.Time) error {
	if failedAttempts == 0 && lockedUntil == nil {
		return nil
	}
	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "failedLoginAttempts" = 0,
		        "lockedUntil" = NULL
		  WHERE id = $1`,
		userID,
	); err != nil {
		return fmt.Errorf("reset failed login counters: %w", err)
	}
	return nil
}

func (s Service) issueTokens(ctx context.Context, user loginUser, ipAddress, userAgent string) (issuedLogin, error) {
	return s.issueTokensForFamily(ctx, user, ipAddress, userAgent, uuid.NewString(), time.Now())
}

func (s Service) issueTokensForFamily(ctx context.Context, user loginUser, ipAddress, userAgent, tokenFamily string, familyCreatedAt time.Time) (issuedLogin, error) {
	now := time.Now()
	active := user.ActiveTenant
	accessTTL := s.AccessTokenTTL
	if accessTTL <= 0 {
		accessTTL = 15 * time.Minute
	}
	if active != nil && active.JWTExpiresInSeconds != nil && *active.JWTExpiresInSeconds > 0 {
		accessTTL = time.Duration(*active.JWTExpiresInSeconds) * time.Second
	}
	refreshTTL := s.RefreshCookieTTL
	if refreshTTL <= 0 {
		refreshTTL = 7 * 24 * time.Hour
	}
	if active != nil && active.JWTRefreshExpiresSeconds != nil && *active.JWTRefreshExpiresSeconds > 0 {
		refreshTTL = time.Duration(*active.JWTRefreshExpiresSeconds) * time.Second
	}

	refreshToken := uuid.NewString()
	var ipUaHash *string
	if s.TokenBinding {
		hash := computeBindingHash(ipAddress, userAgent)
		ipUaHash = &hash
	}

	claims := jwt.MapClaims{
		"userId": user.ID,
		"email":  user.Email,
		"type":   "access",
		"iat":    now.Unix(),
		"exp":    now.Add(accessTTL).Unix(),
	}
	if ipUaHash != nil {
		claims["ipUaHash"] = *ipUaHash
	}
	if active != nil {
		claims["tenantId"] = active.TenantID
		claims["tenantRole"] = active.Role
	}

	accessToken, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(s.JWTSecret)
	if err != nil {
		return issuedLogin{}, fmt.Errorf("sign access token: %w", err)
	}

	if _, err := s.DB.Exec(
		ctx,
		`INSERT INTO "RefreshToken" (id, token, "userId", "tokenFamily", "familyCreatedAt", "expiresAt", "ipUaHash")
		  VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		uuid.NewString(),
		refreshToken,
		user.ID,
		tokenFamily,
		familyCreatedAt,
		now.Add(refreshTTL),
		ipUaHash,
	); err != nil {
		return issuedLogin{}, fmt.Errorf("insert refresh token: %w", err)
	}

	memberships := make([]tenantMembership, 0, len(user.Memberships))
	for _, membership := range user.Memberships {
		memberships = append(memberships, tenantMembership{
			TenantID: membership.TenantID,
			Name:     membership.Name,
			Slug:     membership.Slug,
			Role:     membership.Role,
			Status:   membership.Status,
			Pending:  membership.Status == "PENDING",
			IsActive: membership.IsActive,
		})
	}
	sort.Slice(memberships, func(i, j int) bool {
		rank := func(item tenantMembership) int {
			if item.IsActive {
				return 0
			}
			if item.Pending {
				return 2
			}
			return 1
		}
		ri, rj := rank(memberships[i]), rank(memberships[j])
		if ri != rj {
			return ri < rj
		}
		return memberships[i].Name < memberships[j].Name
	})

	resultUser := loginUserResponse{
		ID:         user.ID,
		Email:      user.Email,
		Username:   user.Username,
		AvatarData: user.AvatarData,
	}
	if active != nil {
		resultUser.TenantID = active.TenantID
		resultUser.TenantRole = active.Role
	}

	return issuedLogin{
		accessToken:       accessToken,
		refreshToken:      refreshToken,
		refreshExpires:    refreshTTL,
		user:              resultUser,
		tenantMemberships: memberships,
	}, nil
}
