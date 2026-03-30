package desktopbroker

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"

	"golang.org/x/crypto/scrypt"
)

const guacamoleSalt = "arsenale-guac-salt"

type TokenEnvelope struct {
	IV    string `json:"iv"`
	Value string `json:"value"`
	Tag   string `json:"tag"`
}

type ConnectionToken struct {
	Connection struct {
		Type      string         `json:"type"`
		Join      string         `json:"join,omitempty"`
		GuacdHost string         `json:"guacdHost,omitempty"`
		GuacdPort int            `json:"guacdPort,omitempty"`
		Settings  map[string]any `json:"settings"`
	} `json:"connection"`
	Metadata map[string]any `json:"metadata,omitempty"`
}

func LoadSecret(envKey, fileEnvKey string) (string, error) {
	if value := os.Getenv(envKey); value != "" {
		return value, nil
	}

	filePath := os.Getenv(fileEnvKey)
	if filePath == "" {
		return "", fmt.Errorf("missing %s or %s", envKey, fileEnvKey)
	}

	payload, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", fileEnvKey, err)
	}

	return string(payload), nil
}

func EncryptToken(secret string, token ConnectionToken) (string, error) {
	if secret == "" {
		return "", errors.New("guacamole secret is required")
	}

	payload, err := json.Marshal(token)
	if err != nil {
		return "", fmt.Errorf("marshal connection token: %w", err)
	}

	key, err := scrypt.Key([]byte(secret), []byte(guacamoleSalt), 16384, 8, 1, 32)
	if err != nil {
		return "", fmt.Errorf("derive guacamole key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}

	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		return "", fmt.Errorf("generate token iv: %w", err)
	}

	ciphertext := gcm.Seal(nil, iv, payload, nil)
	tagSize := gcm.Overhead()
	envelope := TokenEnvelope{
		IV:    base64.StdEncoding.EncodeToString(iv),
		Value: base64.StdEncoding.EncodeToString(ciphertext[:len(ciphertext)-tagSize]),
		Tag:   base64.StdEncoding.EncodeToString(ciphertext[len(ciphertext)-tagSize:]),
	}

	rawEnvelope, err := json.Marshal(envelope)
	if err != nil {
		return "", fmt.Errorf("marshal token envelope: %w", err)
	}

	return base64.StdEncoding.EncodeToString(rawEnvelope), nil
}

func DecryptToken(secret, encryptedToken string) (ConnectionToken, error) {
	var token ConnectionToken
	if secret == "" {
		return token, errors.New("guacamole secret is required")
	}
	if encryptedToken == "" {
		return token, errors.New("token is required")
	}

	rawEnvelope, err := base64.StdEncoding.DecodeString(encryptedToken)
	if err != nil {
		return token, fmt.Errorf("decode token envelope: %w", err)
	}

	var envelope TokenEnvelope
	if err := json.Unmarshal(rawEnvelope, &envelope); err != nil {
		return token, fmt.Errorf("decode token envelope json: %w", err)
	}

	iv, err := base64.StdEncoding.DecodeString(envelope.IV)
	if err != nil {
		return token, fmt.Errorf("decode token iv: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Value)
	if err != nil {
		return token, fmt.Errorf("decode token ciphertext: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(envelope.Tag)
	if err != nil {
		return token, fmt.Errorf("decode token tag: %w", err)
	}

	key, err := scrypt.Key([]byte(secret), []byte(guacamoleSalt), 16384, 8, 1, 32)
	if err != nil {
		return token, fmt.Errorf("derive guacamole key: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return token, fmt.Errorf("create cipher: %w", err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return token, fmt.Errorf("create gcm: %w", err)
	}

	plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return token, fmt.Errorf("decrypt token: %w", err)
	}

	if err := json.Unmarshal(plaintext, &token); err != nil {
		return token, fmt.Errorf("decode connection token: %w", err)
	}

	if token.Connection.Settings == nil {
		token.Connection.Settings = map[string]any{}
	}

	return token, nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func MetadataString(metadata map[string]any, key string) string {
	value, ok := metadata[key]
	if !ok || value == nil {
		return ""
	}

	switch typed := value.(type) {
	case string:
		return typed
	case json.Number:
		return typed.String()
	case float64:
		if typed == float64(int64(typed)) {
			return strconv.FormatInt(int64(typed), 10)
		}
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return fmt.Sprint(value)
	}
}
