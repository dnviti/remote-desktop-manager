package mfaapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"
)

func (s Service) SetupTOTP(ctx context.Context, userID string) (totpSetupResponse, error) {
	user, err := s.loadTOTPUser(ctx, userID)
	if err != nil {
		return totpSetupResponse{}, err
	}
	if user.TOTPEnabled {
		return totpSetupResponse{}, requestErr(http.StatusBadRequest, "2FA is already enabled")
	}

	masterKey, err := s.loadVaultMasterKey(ctx, userID)
	if err != nil {
		return totpSetupResponse{}, err
	}
	if len(masterKey) == 0 {
		return totpSetupResponse{}, requestErr(http.StatusForbidden, "Vault is locked. Please unlock it first.")
	}
	defer zeroBytes(masterKey)

	secret, err := generateTOTPSecret()
	if err != nil {
		return totpSetupResponse{}, err
	}
	enc, err := encryptValue(masterKey, secret)
	if err != nil {
		return totpSetupResponse{}, fmt.Errorf("encrypt totp secret: %w", err)
	}
	if err := s.storeSetupSecret(ctx, userID, enc); err != nil {
		return totpSetupResponse{}, err
	}
	return totpSetupResponse{
		Secret:     secret,
		OtpauthURI: buildOTPAuthURI(user.Email, secret),
	}, nil
}

func (s Service) VerifyAndEnableTOTP(ctx context.Context, userID, code, ipAddress string) (totpEnabledResponse, error) {
	if len(strings.TrimSpace(code)) != 6 {
		return totpEnabledResponse{}, invalidCodeError()
	}

	user, err := s.loadTOTPUser(ctx, userID)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if user.TOTPEnabled {
		return totpEnabledResponse{}, requestErr(http.StatusBadRequest, "2FA is already enabled")
	}

	masterKey, err := s.loadVaultMasterKey(ctx, userID)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if len(masterKey) == 0 {
		return totpEnabledResponse{}, requestErr(http.StatusForbidden, "Vault is locked. Please unlock it first.")
	}
	defer zeroBytes(masterKey)

	secret, err := s.resolveTOTPSecret(masterKey, user)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if !verifyTOTP(secret, code, time.Now()) {
		return totpEnabledResponse{}, invalidCodeError()
	}
	if err := s.enableTOTP(ctx, user, secret, masterKey); err != nil {
		return totpEnabledResponse{}, err
	}
	if err := s.insertAuditLog(ctx, userID, "TOTP_ENABLE", ipAddress); err != nil {
		return totpEnabledResponse{}, err
	}
	return totpEnabledResponse{Enabled: true}, nil
}

func (s Service) DisableTOTP(ctx context.Context, userID, code, ipAddress string) (totpEnabledResponse, error) {
	if len(strings.TrimSpace(code)) != 6 {
		return totpEnabledResponse{}, invalidCodeError()
	}

	user, err := s.loadTOTPUser(ctx, userID)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if !user.TOTPEnabled {
		return totpEnabledResponse{}, requestErr(http.StatusBadRequest, "2FA is not enabled")
	}

	masterKey, err := s.loadVaultMasterKey(ctx, userID)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if len(masterKey) == 0 {
		return totpEnabledResponse{}, requestErr(http.StatusForbidden, "Vault is locked. Please unlock it first.")
	}
	defer zeroBytes(masterKey)

	secret, err := s.resolveTOTPSecret(masterKey, user)
	if err != nil {
		return totpEnabledResponse{}, err
	}
	if !verifyTOTP(secret, code, time.Now()) {
		return totpEnabledResponse{}, invalidCodeError()
	}
	if err := s.disableTOTP(ctx, userID); err != nil {
		return totpEnabledResponse{}, err
	}
	if err := s.insertAuditLog(ctx, userID, "TOTP_DISABLE", ipAddress); err != nil {
		return totpEnabledResponse{}, err
	}
	return totpEnabledResponse{Enabled: false}, nil
}

func (s Service) resolveTOTPSecret(masterKey []byte, user totpUser) (string, error) {
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
	return "", requestErr(http.StatusBadRequest, "2FA setup not initiated")
}
