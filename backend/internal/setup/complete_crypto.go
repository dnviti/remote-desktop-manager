package setup

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"

	"golang.org/x/crypto/argon2"
)

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

func generateSalt() (string, error) {
	value, err := randomBytes(32)
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(value), nil
}

func generateMasterKey() ([]byte, error) {
	return randomBytes(32)
}

func generateRecoveryKey() (string, error) {
	value, err := randomBytes(32)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func deriveKeyFromPassword(password, saltHex string) ([]byte, error) {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil, fmt.Errorf("decode salt: %w", err)
	}
	return argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32), nil
}

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	if len(key) != 32 {
		return encryptedField{}, fmt.Errorf("invalid key length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}
	sealed := gcm.Seal(nil, iv, []byte(plaintext), nil)
	tagOffset := len(sealed) - gcm.Overhead()
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
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
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
	plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt payload: %w", err)
	}
	return string(plaintext), nil
}

func encryptMasterKey(masterKey, derivedKey []byte) (encryptedField, error) {
	return encryptValue(derivedKey, hex.EncodeToString(masterKey))
}

func randomBytes(size int) ([]byte, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return nil, fmt.Errorf("generate random bytes: %w", err)
	}
	return value, nil
}

func zeroBytes(value []byte) {
	for i := range value {
		value[i] = 0
	}
}
