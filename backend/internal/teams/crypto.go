package teams

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
)

func generateRandomKey() ([]byte, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func encryptHexPayload(key []byte, plaintext string) (encryptedField, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagSize := aead.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:len(sealed)-tagSize]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(sealed[len(sealed)-tagSize:]),
	}, nil
}

func decryptEncryptedField(key []byte, field encryptedField) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	iv, err := hex.DecodeString(field.IV)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	ciphertext, err := hex.DecodeString(field.Ciphertext)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	tag, err := hex.DecodeString(field.Tag)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}
	plaintext, err := aead.Open(nil, iv, append(ciphertext, tag...), nil)
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
