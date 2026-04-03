package vaultapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/smsdelivery"
)

const smsOTPTTL = 5 * time.Minute

func (s Service) RequestSMSCode(ctx context.Context, userID string) error {
	if err := s.enforceVaultMFARateLimit(ctx, userID); err != nil {
		return err
	}

	masterKey, err := s.loadVaultRecovery(ctx, userID)
	if err != nil {
		return err
	}
	if len(masterKey) == 0 {
		return &requestError{status: 403, message: "MFA vault recovery unavailable. Please use your password."}
	}
	defer zeroBytes(masterKey)

	user, err := s.loadSMSUnlockUser(ctx, userID)
	if err != nil {
		return err
	}
	if !user.SMSMFAEnabled || strings.TrimSpace(user.PhoneNumber) == "" {
		return &requestError{status: 400, message: "SMS MFA is not available"}
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}
	if err := s.storeOTP(ctx, userID, code); err != nil {
		return err
	}

	status := smsdelivery.StatusFromEnv()
	if err := smsdelivery.Send(ctx, smsdelivery.Message{
		To:   user.PhoneNumber,
		Body: fmt.Sprintf("Your Arsenale verification code is: %s. It expires in 5 minutes.", code),
	}); err != nil {
		return err
	}
	if !status.Configured {
		log.Printf("vaultapi dev sms otp for user=%s phone=%s code=%s", userID, user.PhoneNumber, code)
	}
	return nil
}

func (s Service) UnlockWithSMS(ctx context.Context, userID, code, ipAddress string) (map[string]any, error) {
	if err := s.enforceVaultMFARateLimit(ctx, userID); err != nil {
		return nil, err
	}

	masterKey, err := s.loadVaultRecovery(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(masterKey) == 0 {
		return nil, &requestError{status: 403, message: "MFA vault recovery unavailable. Please use your password."}
	}
	defer zeroBytes(masterKey)

	valid, err := s.verifyOTP(ctx, userID, strings.TrimSpace(code))
	if err != nil {
		return nil, err
	}
	if !valid {
		return nil, &requestError{status: 401, message: "Invalid or expired SMS code"}
	}

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return nil, err
	}
	if err := s.publishVaultStatus(ctx, userID, true); err != nil {
		return nil, err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_UNLOCK", map[string]any{"method": "sms"}, ipAddress); err != nil {
		return nil, err
	}
	return map[string]any{"unlocked": true}, nil
}

func generateOTPCode() (string, error) {
	const max = 1_000_000
	const limit = ^uint32(0) - (^uint32(0) % max)
	for {
		var raw [4]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return "", fmt.Errorf("generate otp: %w", err)
		}
		value := uint32(raw[0])<<24 | uint32(raw[1])<<16 | uint32(raw[2])<<8 | uint32(raw[3])
		if value < limit {
			return fmt.Sprintf("%06d", value%max), nil
		}
	}
}

func hashSMSCode(code string) string {
	sum := sha256.Sum256([]byte(code))
	return hex.EncodeToString(sum[:])
}
