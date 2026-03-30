package tenantvaultapi

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
)

func generateTenantMasterKey() ([]byte, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return nil, fmt.Errorf("generate tenant key: %w", err)
	}
	return buf, nil
}

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	if len(key) != 32 {
		return encryptedField{}, fmt.Errorf("invalid key length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagOffset := len(sealed) - aead.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:tagOffset]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(sealed[tagOffset:]),
	}, nil
}

func decryptValue(key []byte, field encryptedField) (string, error) {
	if len(key) != 32 {
		return "", fmt.Errorf("invalid key length")
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	iv, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	plaintext, err := aead.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt value: %w", err)
	}
	return string(plaintext), nil
}

func encryptTenantKey(tenantKey, userMasterKey []byte) (encryptedField, error) {
	return encryptValue(userMasterKey, hex.EncodeToString(tenantKey))
}

func decryptTenantKey(field encryptedField, userMasterKey []byte) ([]byte, error) {
	plaintext, err := decryptValue(userMasterKey, field)
	if err != nil {
		return nil, err
	}
	key, err := hex.DecodeString(plaintext)
	if err != nil {
		return nil, fmt.Errorf("decode tenant key: %w", err)
	}
	return key, nil
}

func deriveEscrowKey(serverKey []byte, tenantID string) []byte {
	mac := hmac.New(sha256.New, serverKey)
	mac.Write([]byte(tenantID))
	return mac.Sum(nil)
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}
