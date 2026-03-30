package mfaapi

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
	"time"
)

const smsOTPTTL = 5 * time.Minute

var e164PhonePattern = regexp.MustCompile(`^\+[1-9]\d{1,14}$`)

func validatePhoneNumber(phone string) bool {
	return e164PhonePattern.MatchString(strings.TrimSpace(phone))
}

func (s Service) sendOTPToPhone(ctx context.Context, userID, phoneNumber string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	if strings.TrimSpace(os.Getenv("SMS_PROVIDER")) != "" {
		return ErrLegacySMSMFAFlow
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}
	if err := s.storeOTP(ctx, userID, code); err != nil {
		return err
	}

	log.Printf("mfaapi dev sms otp for user=%s phone=%s code=%s", userID, phoneNumber, code)
	return nil
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
