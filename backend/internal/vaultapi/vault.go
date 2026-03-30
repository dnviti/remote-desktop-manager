package vaultapi

import (
	"context"
	"fmt"
	"net/http"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

func (s Service) GetStatus(ctx context.Context, userID string) (statusResponse, error) {
	user, err := s.loadUserSettings(ctx, userID)
	if err != nil {
		return statusResponse{}, err
	}

	unlocked := s.hasRedisKey(ctx, "vault:user:"+userID)
	recoveryAvailable := s.hasRedisKey(ctx, "vault:recovery:"+userID)
	if unlocked || !recoveryAvailable {
		return statusResponse{
			Unlocked:           unlocked,
			VaultNeedsRecovery: user.VaultNeedsRecovery,
			MFAUnlockAvailable: false,
			MFAUnlockMethods:   []string{},
		}, nil
	}

	methods := make([]string, 0, 3)
	if user.WebAuthnEnabled {
		methods = append(methods, "webauthn")
	}
	if user.TOTPEnabled {
		methods = append(methods, "totp")
	}
	if user.SMSMFAEnabled {
		methods = append(methods, "sms")
	}

	return statusResponse{
		Unlocked:           unlocked,
		VaultNeedsRecovery: user.VaultNeedsRecovery,
		MFAUnlockAvailable: len(methods) > 0,
		MFAUnlockMethods:   methods,
	}, nil
}

func (s Service) SoftLock(ctx context.Context, userID, ipAddress string) error {
	if err := s.clearVaultSessions(ctx, userID); err != nil {
		return err
	}
	if err := s.publishVaultStatus(ctx, userID, false); err != nil {
		return err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_LOCK", map[string]any{}, ipAddress); err != nil {
		return err
	}
	return nil
}

func (s Service) Unlock(ctx context.Context, userID, password, ipAddress string) (map[string]any, error) {
	creds, err := s.loadVaultCredentials(ctx, userID)
	if err != nil {
		return nil, err
	}
	if creds.VaultSalt == nil || creds.EncryptedVaultKey == nil || creds.VaultKeyIV == nil || creds.VaultKeyTag == nil ||
		*creds.VaultSalt == "" || *creds.EncryptedVaultKey == "" || *creds.VaultKeyIV == "" || *creds.VaultKeyTag == "" {
		return nil, &requestError{status: http.StatusBadRequest, message: "Vault not set up. Please set a vault password first."}
	}

	derived := deriveKeyFromPassword(password, *creds.VaultSalt)
	if len(derived) == 0 {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid password"}
	}
	defer zeroBytes(derived)

	masterKey, err := decryptMasterKey(encryptedField{
		Ciphertext: *creds.EncryptedVaultKey,
		IV:         *creds.VaultKeyIV,
		Tag:        *creds.VaultKeyTag,
	}, derived)
	if err != nil {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid password"}
	}
	defer zeroBytes(masterKey)

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return nil, err
	}
	if err := s.publishVaultStatus(ctx, userID, true); err != nil {
		return nil, err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_UNLOCK", map[string]any{}, ipAddress); err != nil {
		return nil, err
	}

	return map[string]any{"unlocked": true}, nil
}

func (s Service) RecoverWithKey(ctx context.Context, userID, recoveryKey, currentPassword, ipAddress string) (map[string]any, error) {
	creds, err := s.loadVaultCredentials(ctx, userID)
	if err != nil {
		return nil, err
	}
	if !creds.VaultNeedsRecovery {
		return nil, &requestError{status: http.StatusBadRequest, message: "Vault does not need recovery"}
	}
	if creds.EncryptedVaultRecoveryKey == nil || creds.VaultRecoveryKeyIV == nil || creds.VaultRecoveryKeyTag == nil || creds.VaultRecoveryKeySalt == nil ||
		*creds.EncryptedVaultRecoveryKey == "" || *creds.VaultRecoveryKeyIV == "" || *creds.VaultRecoveryKeyTag == "" || *creds.VaultRecoveryKeySalt == "" {
		return nil, &requestError{status: http.StatusBadRequest, message: "No recovery key available. You must reset your vault."}
	}
	if creds.PasswordHash == nil || *creds.PasswordHash == "" {
		return nil, &requestError{status: http.StatusBadRequest, message: "No password set for this account"}
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*creds.PasswordHash), []byte(currentPassword)); err != nil {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid password"}
	}

	masterKey, err := decryptMasterKeyWithRecovery(encryptedField{
		Ciphertext: *creds.EncryptedVaultRecoveryKey,
		IV:         *creds.VaultRecoveryKeyIV,
		Tag:        *creds.VaultRecoveryKeyTag,
	}, recoveryKey, *creds.VaultRecoveryKeySalt)
	if err != nil {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid recovery key"}
	}
	defer zeroBytes(masterKey)

	newSalt := generateSalt()
	derived := deriveKeyFromPassword(currentPassword, newSalt)
	defer zeroBytes(derived)

	newEncryptedVault, err := encryptMasterKey(masterKey, derived)
	if err != nil {
		return nil, fmt.Errorf("encrypt master key: %w", err)
	}

	newRecoveryKey, err := generateRecoveryKey()
	if err != nil {
		return nil, fmt.Errorf("generate recovery key: %w", err)
	}
	newRecoverySalt := generateSalt()
	recoveryDerived := deriveKeyFromPassword(newRecoveryKey, newRecoverySalt)
	defer zeroBytes(recoveryDerived)

	newRecovery, err := encryptMasterKey(masterKey, recoveryDerived)
	if err != nil {
		return nil, fmt.Errorf("encrypt recovery key: %w", err)
	}

	if _, err := s.DB.Exec(
		ctx,
		`UPDATE "User"
		    SET "vaultSalt" = $2,
		        "encryptedVaultKey" = $3,
		        "vaultKeyIV" = $4,
		        "vaultKeyTag" = $5,
		        "encryptedVaultRecoveryKey" = $6,
		        "vaultRecoveryKeyIV" = $7,
		        "vaultRecoveryKeyTag" = $8,
		        "vaultRecoveryKeySalt" = $9,
		        "vaultNeedsRecovery" = false,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		newSalt,
		newEncryptedVault.Ciphertext,
		newEncryptedVault.IV,
		newEncryptedVault.Tag,
		newRecovery.Ciphertext,
		newRecovery.IV,
		newRecovery.Tag,
		newRecoverySalt,
	); err != nil {
		return nil, fmt.Errorf("update vault recovery fields: %w", err)
	}

	if err := s.clearVaultSessions(ctx, userID); err != nil {
		return nil, err
	}
	if err := s.clearVaultRecovery(ctx, userID); err != nil {
		return nil, err
	}
	if err := s.insertAuditLog(ctx, userID, "VAULT_RECOVERED", map[string]any{"method": "recovery_key"}, ipAddress); err != nil {
		return nil, err
	}

	return map[string]any{"success": true, "newRecoveryKey": newRecoveryKey}, nil
}

func (s Service) ExplicitReset(ctx context.Context, userID, password, ipAddress string) (map[string]any, error) {
	creds, err := s.loadVaultCredentials(ctx, userID)
	if err != nil {
		return nil, err
	}
	if creds.PasswordHash == nil || *creds.PasswordHash == "" {
		return nil, &requestError{status: http.StatusBadRequest, message: "No password set for this account"}
	}
	if err := bcrypt.CompareHashAndPassword([]byte(*creds.PasswordHash), []byte(password)); err != nil {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid password"}
	}

	masterKey := generateMasterKey()
	defer zeroBytes(masterKey)

	newSalt := generateSalt()
	derived := deriveKeyFromPassword(password, newSalt)
	defer zeroBytes(derived)

	newEncryptedVault, err := encryptMasterKey(masterKey, derived)
	if err != nil {
		return nil, fmt.Errorf("encrypt master key: %w", err)
	}

	newRecoveryKey, err := generateRecoveryKey()
	if err != nil {
		return nil, fmt.Errorf("generate recovery key: %w", err)
	}
	newRecoverySalt := generateSalt()
	recoveryDerived := deriveKeyFromPassword(newRecoveryKey, newRecoverySalt)
	defer zeroBytes(recoveryDerived)

	newRecovery, err := encryptMasterKey(masterKey, recoveryDerived)
	if err != nil {
		return nil, fmt.Errorf("encrypt recovery key: %w", err)
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin explicit reset: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(
		ctx,
		`UPDATE "User"
		    SET "vaultSalt" = $2,
		        "encryptedVaultKey" = $3,
		        "vaultKeyIV" = $4,
		        "vaultKeyTag" = $5,
		        "encryptedVaultRecoveryKey" = $6,
		        "vaultRecoveryKeyIV" = $7,
		        "vaultRecoveryKeyTag" = $8,
		        "vaultRecoveryKeySalt" = $9,
		        "vaultNeedsRecovery" = false,
		        "encryptedTotpSecret" = NULL,
		        "totpSecretIV" = NULL,
		        "totpSecretTag" = NULL,
		        "totpSecret" = NULL,
		        "totpEnabled" = false,
		        "encryptedDomainPassword" = NULL,
		        "domainPasswordIV" = NULL,
		        "domainPasswordTag" = NULL,
		        "updatedAt" = NOW()
		  WHERE id = $1`,
		userID,
		newSalt,
		newEncryptedVault.Ciphertext,
		newEncryptedVault.IV,
		newEncryptedVault.Tag,
		newRecovery.Ciphertext,
		newRecovery.IV,
		newRecovery.Tag,
		newRecoverySalt,
	); err != nil {
		return nil, fmt.Errorf("update vault reset fields: %w", err)
	}

	statements := []string{
		`UPDATE "Connection"
		    SET "encryptedPassword" = NULL,
		        "passwordIV" = NULL,
		        "passwordTag" = NULL,
		        "encryptedUsername" = NULL,
		        "usernameIV" = NULL,
		        "usernameTag" = NULL,
		        "encryptedDomain" = NULL,
		        "domainIV" = NULL,
		        "domainTag" = NULL
		  WHERE "userId" = $1`,
		`DELETE FROM "SharedConnection" WHERE "sharedByUserId" = $1`,
		`UPDATE "SharedConnection"
		    SET "encryptedPassword" = NULL,
		        "passwordIV" = NULL,
		        "passwordTag" = NULL,
		        "encryptedUsername" = NULL,
		        "usernameIV" = NULL,
		        "usernameTag" = NULL,
		        "encryptedDomain" = NULL,
		        "domainIV" = NULL,
		        "domainTag" = NULL
		  WHERE "sharedWithUserId" = $1`,
		`DELETE FROM "SharedSecret" WHERE "sharedByUserId" = $1`,
		`DELETE FROM "SharedSecret" WHERE "sharedWithUserId" = $1`,
		`DELETE FROM "ExternalSecretShare" WHERE "secretId" IN (SELECT id FROM "VaultSecret" WHERE "userId" = $1)`,
		`DELETE FROM "VaultSecret" WHERE "userId" = $1`,
		`DELETE FROM "TenantVaultMember" WHERE "userId" = $1`,
	}
	for _, statement := range statements {
		if _, err := tx.Exec(ctx, statement, userID); err != nil {
			return nil, fmt.Errorf("explicit reset cleanup: %w", err)
		}
	}

	if err := s.insertAuditLogTx(ctx, tx, userID, "VAULT_EXPLICIT_RESET", map[string]any{"reason": "user_requested"}, ipAddress); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit explicit reset: %w", err)
	}

	if err := s.clearVaultSessions(ctx, userID); err != nil {
		return nil, err
	}
	if err := s.clearVaultRecovery(ctx, userID); err != nil {
		return nil, err
	}

	return map[string]any{"success": true, "newRecoveryKey": newRecoveryKey}, nil
}

func (s Service) GetAutoLockPreference(ctx context.Context, userID, tenantID string) (autoLockResponse, error) {
	user, err := s.loadUserSettings(ctx, userID)
	if err != nil {
		return autoLockResponse{}, err
	}
	policy, err := s.loadTenantPolicy(ctx, userID, tenantID)
	if err != nil {
		return autoLockResponse{}, err
	}

	return autoLockResponse{
		AutoLockMinutes: user.AutoLockMinutes,
		EffectiveMinute: resolveEffectiveMinutes(user.AutoLockMinutes, policy.DefaultMinutes, policy.MaxMinutes),
		TenantMaxMinute: policy.MaxMinutes,
	}, nil
}

func (s Service) SetAutoLockPreference(ctx context.Context, userID, tenantID string, autoLockMinutes *int) (autoLockResponse, error) {
	if autoLockMinutes != nil && *autoLockMinutes < 0 {
		return autoLockResponse{}, &requestError{
			status:  http.StatusBadRequest,
			message: "Auto-lock minutes must be 0 (never) or a positive number",
		}
	}

	policy, err := s.loadTenantPolicy(ctx, userID, tenantID)
	if err != nil {
		return autoLockResponse{}, err
	}
	if policy.MaxMinutes != nil && *policy.MaxMinutes > 0 {
		if autoLockMinutes != nil && *autoLockMinutes == 0 {
			return autoLockResponse{}, &requestError{
				status:  http.StatusForbidden,
				message: fmt.Sprintf(`Your organization enforces a maximum vault auto-lock of %d minutes. "Never" is not allowed.`, *policy.MaxMinutes),
			}
		}
		if autoLockMinutes != nil && *autoLockMinutes > *policy.MaxMinutes {
			return autoLockResponse{}, &requestError{
				status:  http.StatusForbidden,
				message: fmt.Sprintf("Your organization enforces a maximum vault auto-lock of %d minutes.", *policy.MaxMinutes),
			}
		}
	}

	if s.DB == nil {
		return autoLockResponse{}, fmt.Errorf("database is unavailable")
	}
	if _, err := s.DB.Exec(ctx, `UPDATE "User" SET "vaultAutoLockMinutes" = $2 WHERE id = $1`, userID, autoLockMinutes); err != nil {
		return autoLockResponse{}, fmt.Errorf("update vault auto-lock preference: %w", err)
	}

	return autoLockResponse{
		AutoLockMinutes: autoLockMinutes,
		EffectiveMinute: resolveEffectiveMinutes(autoLockMinutes, policy.DefaultMinutes, policy.MaxMinutes),
		TenantMaxMinute: policy.MaxMinutes,
	}, nil
}

func (s Service) GetRecoveryStatus(ctx context.Context, userID string) (map[string]any, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	var (
		needsRecovery     bool
		encryptedRecovery *string
		recoveryIV        *string
		recoveryTag       *string
		recoverySalt      *string
	)
	if err := s.DB.QueryRow(
		ctx,
		`SELECT COALESCE("vaultNeedsRecovery", false),
		        "encryptedVaultRecoveryKey",
		        "vaultRecoveryKeyIV",
		        "vaultRecoveryKeyTag",
		        "vaultRecoveryKeySalt"
		   FROM "User"
		  WHERE id = $1`,
		userID,
	).Scan(
		&needsRecovery,
		&encryptedRecovery,
		&recoveryIV,
		&recoveryTag,
		&recoverySalt,
	); err != nil {
		if err == pgx.ErrNoRows {
			return nil, &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return nil, fmt.Errorf("load vault recovery status: %w", err)
	}

	return map[string]any{
		"needsRecovery": needsRecovery,
		"hasRecoveryKey": encryptedRecovery != nil &&
			recoveryIV != nil &&
			recoveryTag != nil &&
			recoverySalt != nil,
	}, nil
}
