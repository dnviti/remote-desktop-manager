package authservice

import (
	"context"
	"crypto/rand"
	"encoding/base32"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
)

const loginTOTPAppName = "Arsenale"

func (s Service) SetupMFADuringLogin(ctx context.Context, tempToken string) (map[string]any, error) {
	userID, purpose, err := s.parseMFATempToken(tempToken)
	if err != nil {
		return nil, err
	}
	if purpose != "mfa-setup" {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}

	user, err := s.loadMFAUser(ctx, userID)
	if err != nil {
		return nil, err
	}
	if user.TOTPEnabled {
		return nil, &requestError{status: http.StatusBadRequest, message: "2FA is already enabled"}
	}

	masterKey, err := s.loadVaultMasterKey(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(masterKey) == 0 {
		return nil, &requestError{status: http.StatusForbidden, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(masterKey)

	secret, err := generateLoginTOTPSecret()
	if err != nil {
		return nil, err
	}
	enc, err := encryptValue(masterKey, secret)
	if err != nil {
		return nil, fmt.Errorf("encrypt totp secret: %w", err)
	}
	if err := s.storeLoginSetupSecret(ctx, userID, enc); err != nil {
		return nil, err
	}

	return map[string]any{
		"secret":     secret,
		"otpauthUri": buildLoginOTPAuthURI(user.Email, secret),
	}, nil
}

func (s Service) VerifyMFASetupDuringLogin(ctx context.Context, tempToken, code, ipAddress, userAgent string) (issuedLogin, error) {
	userID, purpose, err := s.parseMFATempToken(tempToken)
	if err != nil {
		return issuedLogin{}, err
	}
	if purpose != "mfa-setup" {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Invalid token purpose"}
	}
	if err := validateTOTPCode(code); err != nil {
		return issuedLogin{}, err
	}

	user, err := s.loadMFAUser(ctx, userID)
	if err != nil {
		return issuedLogin{}, err
	}
	if user.TOTPEnabled {
		return issuedLogin{}, &requestError{status: http.StatusBadRequest, message: "2FA is already enabled"}
	}

	masterKey, err := s.loadVaultMasterKey(ctx, userID)
	if err != nil {
		return issuedLogin{}, err
	}
	if len(masterKey) == 0 {
		return issuedLogin{}, &requestError{status: http.StatusForbidden, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(masterKey)

	secret, err := s.resolveTOTPSecret(ctx, user)
	if err != nil {
		return issuedLogin{}, err
	}
	if !verifyTOTP(secret, code, time.Now()) {
		return issuedLogin{}, &requestError{status: http.StatusUnauthorized, message: "Invalid TOTP code"}
	}
	if err := s.enableLoginTOTP(ctx, user, secret, masterKey); err != nil {
		return issuedLogin{}, err
	}

	loginUser, err := s.loadLoginUserByID(ctx, userID)
	if err != nil {
		return issuedLogin{}, err
	}
	result, err := s.issueTokens(ctx, loginUser, ipAddress, userAgent)
	if err != nil {
		return issuedLogin{}, err
	}
	_ = s.insertStandaloneAuditLog(ctx, &userID, "TOTP_ENABLE", map[string]any{}, ipAddress)
	_ = s.insertStandaloneAuditLog(ctx, &userID, "LOGIN", map[string]any{}, ipAddress)
	return result, nil
}

func (s Service) storeLoginSetupSecret(ctx context.Context, userID string, field encryptedField) error {
	_, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "encryptedTotpSecret" = $2,
		        "totpSecretIV" = $3,
		        "totpSecretTag" = $4,
		        "totpSecret" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		field.Ciphertext,
		field.IV,
		field.Tag,
	)
	if err != nil {
		return fmt.Errorf("store setup secret: %w", err)
	}
	return nil
}

func (s Service) enableLoginTOTP(ctx context.Context, user mfaUser, secret string, masterKey []byte) error {
	if user.TOTPSecret != nil && *user.TOTPSecret != "" {
		enc, err := encryptValue(masterKey, secret)
		if err != nil {
			return fmt.Errorf("encrypt totp secret: %w", err)
		}
		_, err = s.DB.Exec(
			ctx,
			`UPDATE "User"
			    SET "totpEnabled" = true,
			        "encryptedTotpSecret" = $2,
			        "totpSecretIV" = $3,
			        "totpSecretTag" = $4,
			        "totpSecret" = NULL,
			        "updatedAt" = NOW()
			  WHERE id = $1`,
			user.ID,
			enc.Ciphertext,
			enc.IV,
			enc.Tag,
		)
		if err != nil {
			return fmt.Errorf("enable totp: %w", err)
		}
		return nil
	}

	_, err := s.DB.Exec(ctx, `UPDATE "User" SET "totpEnabled" = true, "updatedAt" = NOW() WHERE id = $1`, user.ID)
	if err != nil {
		return fmt.Errorf("enable totp: %w", err)
	}
	return nil
}

func generateLoginTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("generate totp secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func buildLoginOTPAuthURI(email, secret string) string {
	label := url.PathEscape(loginTOTPAppName + ":" + email)
	return fmt.Sprintf(
		"otpauth://totp/%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		label,
		url.QueryEscape(secret),
		url.QueryEscape(loginTOTPAppName),
	)
}
