package authservice

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/dnviti/arsenale/backend/internal/emaildelivery"
	"github.com/jackc/pgx/v5"
	"github.com/redis/go-redis/v9"
)

const loginEmailCodeTTL = 5 * time.Minute

func loginEmailCodeKey(userID string) string {
	return "auth:login-email-code:" + userID
}

func hashEmailCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}

func (s Service) RequestLoginEmailCode(ctx context.Context, tempToken string) error {
	if s.Redis == nil {
		return fmt.Errorf("redis is not configured")
	}

	claims, err := s.parseTempTokenClaims(tempToken)
	if err != nil {
		return err
	}
	userID := stringClaim(claims, "userId")
	purpose := stringClaim(claims, "purpose")
	primaryMethod := stringClaim(claims, "primaryMethod")
	if primaryMethod == "" {
		primaryMethod = primaryMethodPassword
	}
	if userID == "" {
		return &requestError{status: 401, message: "Invalid or expired temporary token"}
	}
	if purpose != "mfa-verify" {
		return &requestError{status: 401, message: "Invalid token purpose"}
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return &requestError{status: 401, message: "Invalid or expired temporary token"}
		}
		return err
	}
	if !containsString(s.effectiveLoginMFAMethods(user, primaryMethod), loginMFAMethodEmail) {
		return &requestError{status: 400, message: "Email MFA is not available"}
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}
	if err := s.Redis.Set(ctx, loginEmailCodeKey(userID), hashEmailCode(code), loginEmailCodeTTL).Err(); err != nil {
		return fmt.Errorf("store email login code: %w", err)
	}

	status := emaildelivery.StatusFromEnv()
	if !status.Configured {
		log.Printf("authservice dev email mfa code for user=%s email=%s code=%s", userID, user.Email, code)
		return nil
	}
	return emaildelivery.Send(ctx, emaildelivery.Message{
		To:      user.Email,
		Subject: "Your Arsenale verification code",
		HTML: "<h2>Sign-in Verification</h2>" +
			"<p>Your verification code is: <strong>" + code + "</strong></p>" +
			"<p>This code expires in 5 minutes.</p>" +
			"<p>If you did not try to sign in, you can ignore this message.</p>",
		Text: "Your Arsenale verification code is: " + code +
			"\n\nThis code expires in 5 minutes." +
			"\nIf you did not try to sign in, you can ignore this message.",
	})
}

func (s Service) VerifyEmailCode(ctx context.Context, tempToken, code, ipAddress, userAgent string) (issuedLogin, error) {
	if s.Redis == nil {
		return issuedLogin{}, fmt.Errorf("redis is not configured")
	}

	claims, err := s.parseTempTokenClaims(tempToken)
	if err != nil {
		return issuedLogin{}, err
	}
	userID := stringClaim(claims, "userId")
	purpose := stringClaim(claims, "purpose")
	primaryMethod := stringClaim(claims, "primaryMethod")
	if primaryMethod == "" {
		primaryMethod = primaryMethodPassword
	}
	if userID == "" {
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired temporary token"}
	}
	if purpose != "mfa-verify" {
		return issuedLogin{}, &requestError{status: 401, message: "Invalid token purpose"}
	}
	if err := s.enforceLoginMFARateLimit(ctx, userID, ipAddress); err != nil {
		return issuedLogin{}, err
	}
	if err := validateTOTPCode(code); err != nil {
		return issuedLogin{}, &requestError{status: 400, message: "Invalid code format"}
	}

	user, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		if err == pgx.ErrNoRows {
			return issuedLogin{}, &requestError{status: 401, message: "Email MFA verification failed"}
		}
		return issuedLogin{}, err
	}
	if !containsString(s.effectiveLoginMFAMethods(user, primaryMethod), loginMFAMethodEmail) {
		return issuedLogin{}, &requestError{status: 401, message: "Email MFA verification failed"}
	}

	storedHash, err := s.Redis.Get(ctx, loginEmailCodeKey(userID)).Result()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired email code"}
		}
		return issuedLogin{}, fmt.Errorf("load email login code: %w", err)
	}
	if storedHash != hashEmailCode(code) {
		return issuedLogin{}, &requestError{status: 401, message: "Invalid or expired email code"}
	}
	if err := s.Redis.Del(ctx, loginEmailCodeKey(userID)).Err(); err != nil {
		return issuedLogin{}, fmt.Errorf("clear email login code: %w", err)
	}

	allowlistDecision := evaluateIPAllowlist(user.ActiveTenant, ipAddress)
	if allowlistDecision.Blocked {
		return issuedLogin{}, s.rejectBlockedIPAllowlist(ctx, user.ID, ipAddress)
	}

	result, err := s.issueTokens(ctx, user, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, err
	}
	_ = s.insertStandaloneAuditLogWithFlags(ctx, &user.ID, "LOGIN_EMAIL", map[string]any{}, ipAddress, allowlistDecision.Flags())
	return result, nil
}
