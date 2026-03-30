package vaultapi

import (
	"context"
	"crypto/hmac"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

func (s Service) UnlockWithTOTP(ctx context.Context, userID, code, ipAddress string) (map[string]any, error) {
	masterKey, err := s.loadVaultRecovery(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(masterKey) == 0 {
		return nil, &requestError{status: http.StatusForbidden, message: "MFA vault recovery unavailable. Please use your password."}
	}
	defer zeroBytes(masterKey)

	user, err := s.loadTOTPUnlockUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !user.TOTPEnabled {
		return nil, &requestError{status: http.StatusBadRequest, message: "TOTP is not enabled"}
	}

	secret, err := resolveTOTPSecret(masterKey, user)
	if err != nil {
		return nil, &requestError{status: http.StatusInternalServerError, message: "Failed to decrypt TOTP secret"}
	}
	if !verifyTOTPCode(secret, strings.TrimSpace(code), time.Now()) {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid TOTP code"}
	}

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return nil, err
	}
	if err := s.publishVaultStatus(ctx, userID, true); err != nil {
		return nil, err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_UNLOCK", map[string]any{"method": "totp"}, ipAddress); err != nil {
		return nil, err
	}
	return map[string]any{"unlocked": true}, nil
}

func resolveTOTPSecret(masterKey []byte, user totpUnlockUser) (string, error) {
	if user.EncryptedTOTPSecret != nil && user.TOTPSecretIV != nil && user.TOTPSecretTag != nil &&
		*user.EncryptedTOTPSecret != "" && *user.TOTPSecretIV != "" && *user.TOTPSecretTag != "" {
		return decryptEncryptedField(masterKey, encryptedField{
			Ciphertext: *user.EncryptedTOTPSecret,
			IV:         *user.TOTPSecretIV,
			Tag:        *user.TOTPSecretTag,
		})
	}
	if user.TOTPSecret != nil && strings.TrimSpace(*user.TOTPSecret) != "" {
		return strings.TrimSpace(*user.TOTPSecret), nil
	}
	return "", fmt.Errorf("missing totp secret")
}

func verifyTOTPCode(secret, code string, now time.Time) bool {
	if len(code) != 6 {
		return false
	}
	key, err := decodeTOTPSecret(secret)
	if err != nil || len(key) == 0 {
		return false
	}
	counter := now.UTC().Unix() / 30
	for _, offset := range []int64{-1, 0, 1} {
		if totpCode(key, counter+offset) == code {
			return true
		}
	}
	return false
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.TrimSpace(secret))
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	cleaned = strings.ReplaceAll(cleaned, "-", "")
	decoder := base32.StdEncoding.WithPadding(base32.NoPadding)
	return decoder.DecodeString(cleaned)
}

func totpCode(key []byte, counter int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := int(binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff)
	return fmt.Sprintf("%06d", value%1_000_000)
}

func TOTPCodeForTime(secret string, now time.Time) (string, error) {
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		return "", err
	}
	return totpCode(key, now.UTC().Unix()/30), nil
}

func ParseTOTPCode(raw string) (string, error) {
	code := strings.TrimSpace(raw)
	if len(code) != 6 {
		return "", fmt.Errorf("code must be 6 digits")
	}
	if _, err := strconv.Atoi(code); err != nil {
		return "", fmt.Errorf("code must be 6 digits")
	}
	return code, nil
}
