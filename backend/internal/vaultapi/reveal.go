package vaultapi

import (
	"context"
	"errors"
	"net/http"
)

var ErrLegacyRevealPasswordFlow = errors.New("legacy reveal-password flow required")

func (s Service) RevealPassword(ctx context.Context, userID, connectionID, password string) (map[string]any, error) {
	masterKey, err := s.resolveRevealMasterKey(ctx, userID, password)
	if err != nil {
		return nil, err
	}
	defer zeroBytes(masterKey)

	owned, err := s.loadOwnedRevealCredential(ctx, connectionID, userID)
	if err == nil {
		return s.revealCredential(owned, masterKey)
	}
	if !errors.Is(err, notFoundError("owned reveal credential")) {
		return nil, err
	}

	shared, err := s.loadSharedRevealCredential(ctx, connectionID, userID)
	if err == nil {
		return s.revealCredential(shared, masterKey)
	}
	if !errors.Is(err, notFoundError("shared reveal credential")) {
		return nil, err
	}

	return nil, &requestError{status: http.StatusForbidden, message: "Connection not found or insufficient permissions"}
}

func (s Service) resolveRevealMasterKey(ctx context.Context, userID, password string) ([]byte, error) {
	masterKey, err := s.loadVaultSession(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(masterKey) > 0 {
		return masterKey, nil
	}

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

	masterKey, err = decryptMasterKey(encryptedField{
		Ciphertext: *creds.EncryptedVaultKey,
		IV:         *creds.VaultKeyIV,
		Tag:        *creds.VaultKeyTag,
	}, derived)
	if err != nil {
		return nil, &requestError{status: http.StatusUnauthorized, message: "Invalid password"}
	}
	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		zeroBytes(masterKey)
		return nil, err
	}
	return masterKey, nil
}

func (s Service) revealCredential(record revealCredentialRecord, masterKey []byte) (map[string]any, error) {
	if record.RequiresLegacy {
		return nil, ErrLegacyRevealPasswordFlow
	}
	if record.Password == nil || record.Password.IV == "" || record.Password.Tag == "" || record.Password.Ciphertext == "" {
		return nil, &requestError{status: http.StatusForbidden, message: "Connection not found or insufficient permissions"}
	}
	plaintext, err := decryptEncryptedField(masterKey, *record.Password)
	if err != nil {
		return nil, &requestError{status: http.StatusForbidden, message: "Connection not found or insufficient permissions"}
	}
	return map[string]any{"password": plaintext}, nil
}
