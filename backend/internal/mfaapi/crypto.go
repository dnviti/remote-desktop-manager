package mfaapi

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"

	"github.com/redis/go-redis/v9"
)

func (s Service) loadVaultMasterKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerKey) == 0 {
		return nil, nil
	}

	for _, key := range []string{"vault:user:" + userID, "vault:recovery:" + userID} {
		raw, err := s.Redis.Get(ctx, key).Bytes()
		switch {
		case err == nil:
			var field encryptedField
			if err := json.Unmarshal(raw, &field); err != nil {
				return nil, fmt.Errorf("decode vault session: %w", err)
			}
			masterKeyHex, err := decryptEncryptedField(s.ServerKey, field)
			if err != nil {
				return nil, fmt.Errorf("decrypt vault session: %w", err)
			}
			defer zeroString(&masterKeyHex)
			masterKey, err := hex.DecodeString(masterKeyHex)
			if err != nil {
				return nil, fmt.Errorf("decode vault session key: %w", err)
			}
			return masterKey, nil
		case err == redis.Nil:
			continue
		default:
			return nil, fmt.Errorf("load vault session: %w", err)
		}
	}

	return nil, nil
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
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

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

func zeroString(value *string) {
	if value == nil {
		return
	}
	*value = ""
}
