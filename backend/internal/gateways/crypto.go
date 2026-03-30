package gateways

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"

	"github.com/redis/go-redis/v9"
)

func (s Service) getVaultKey(ctx context.Context, userID string) ([]byte, error) {
	if s.Redis == nil || len(s.ServerEncryptionKey) != 32 {
		return nil, nil
	}
	key := "vault:user:" + userID
	payload, err := s.Redis.Get(ctx, key).Bytes()
	if err != nil {
		if errors.Is(err, redis.Nil) {
			return nil, nil
		}
		return nil, fmt.Errorf("load vault session: %w", err)
	}

	var field encryptedField
	if err := json.Unmarshal(payload, &field); err != nil {
		return nil, fmt.Errorf("decode vault session payload: %w", err)
	}
	hexKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return nil, fmt.Errorf("decrypt vault session: %w", err)
	}
	masterKey, err := hex.DecodeString(hexKey)
	if err != nil {
		return nil, fmt.Errorf("decode vault master key: %w", err)
	}
	return masterKey, nil
}

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return encryptedField{}, fmt.Errorf("generate nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:len(sealed)-tagSize]),
		IV:         hex.EncodeToString(nonce),
		Tag:        hex.EncodeToString(sealed[len(sealed)-tagSize:]),
	}, nil
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	nonce, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode nonce: %w", err)
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	plaintext, err := gcm.Open(nil, nonce, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}
	return string(plaintext), nil
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}
