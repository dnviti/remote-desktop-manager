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
	"strings"
	"time"

	"golang.org/x/crypto/scrypt"
)

const (
	guacamoleSalt               = "arsenale-guac-salt"
	MetadataKeyObserveSessionID = "observeSessionId"
)

var ErrSecretNotConfigured = errors.New("secret not configured")

type TokenEnvelope struct {
	IV    string `json:"iv"`
	Value string `json:"value"`
	Tag   string `json:"tag"`
}

type ConnectionToken struct {
	ExpiresAt  time.Time `json:"expiresAt,omitempty"`
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
	if rawValue, ok := os.LookupEnv(envKey); ok {
		value := strings.TrimSpace(rawValue)
		if value == "" {
			return "", fmt.Errorf("%s is set but empty", envKey)
		}
		return value, nil
	}

	if rawPath, ok := os.LookupEnv(fileEnvKey); ok {
		filePath := strings.TrimSpace(rawPath)
		if filePath == "" {
			return "", fmt.Errorf("%s is set but empty", fileEnvKey)
		}

		payload, err := os.ReadFile(filePath)
		if err != nil {
			return "", fmt.Errorf("read %s: %w", fileEnvKey, err)
		}

		value := strings.TrimSpace(string(payload))
		if value == "" {
			return "", fmt.Errorf("%s points to an empty secret", fileEnvKey)
		}

		return value, nil
	}

	return "", fmt.Errorf("%w: missing %s or %s", ErrSecretNotConfigured, envKey, fileEnvKey)
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

	return base64.RawURLEncoding.EncodeToString(rawEnvelope), nil
}

func DecryptToken(secret, encryptedToken string) (ConnectionToken, error) {
	var token ConnectionToken
	if secret == "" {
		return token, errors.New("guacamole secret is required")
	}
	if encryptedToken == "" {
		return token, errors.New("token is required")
	}

	rawEnvelope, err := decodeBase64Token(encryptedToken)
	if err != nil {
		return token, fmt.Errorf("decode token envelope: %w", err)
	}

	var envelope TokenEnvelope
	if err := json.Unmarshal(rawEnvelope, &envelope); err != nil {
		return token, fmt.Errorf("decode token envelope json: %w", err)
	}

	iv, err := decodeBase64Token(envelope.IV)
	if err != nil {
		return token, fmt.Errorf("decode token iv: %w", err)
	}
	ciphertext, err := decodeBase64Token(envelope.Value)
	if err != nil {
		return token, fmt.Errorf("decode token ciphertext: %w", err)
	}
	tag, err := decodeBase64Token(envelope.Tag)
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
	if !token.ExpiresAt.IsZero() {
		token.ExpiresAt = token.ExpiresAt.UTC()
	}

	return token, nil
}

func HashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return fmt.Sprintf("%x", sum[:])
}

func decodeBase64Token(value string) ([]byte, error) {
	normalized := strings.TrimSpace(value)
	if normalized == "" {
		return nil, errors.New("empty base64 token")
	}

	candidates := []string{normalized}
	// Legacy tokens used standard base64 in a query string. If a client or proxy
	// forwards '+' without escaping it, net/url decodes it as a space.
	if strings.Contains(normalized, " ") {
		candidates = append(candidates, strings.ReplaceAll(normalized, " ", "+"))
	}

	encodings := []*base64.Encoding{
		base64.RawURLEncoding,
		base64.URLEncoding,
		base64.StdEncoding,
		base64.RawStdEncoding,
	}

	var lastErr error
	for _, candidate := range candidates {
		for _, encoding := range encodings {
			decoded, err := encoding.DecodeString(candidate)
			if err == nil {
				return decoded, nil
			}
			lastErr = err
		}
	}

	return nil, lastErr
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
