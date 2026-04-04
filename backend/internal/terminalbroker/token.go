package terminalbroker

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/desktopbroker"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
	"golang.org/x/crypto/scrypt"
)

const terminalGrantSalt = "arsenale-terminal-broker"

type tokenEnvelope struct {
	IV    string `json:"iv"`
	Value string `json:"value"`
	Tag   string `json:"tag"`
}

func LoadSecret() (string, error) {
	secret, err := desktopbroker.LoadSecret("TERMINAL_BROKER_SECRET", "TERMINAL_BROKER_SECRET_FILE")
	if err == nil {
		return secret, nil
	}
	if !errors.Is(err, desktopbroker.ErrSecretNotConfigured) {
		return "", err
	}

	return desktopbroker.LoadSecret("GUACAMOLE_SECRET", "GUACAMOLE_SECRET_FILE")
}

func IssueGrant(secret string, grant contracts.TerminalSessionGrant) (string, error) {
	normalized, err := normalizeGrant(grant)
	if err != nil {
		return "", err
	}

	payload, err := json.Marshal(normalized)
	if err != nil {
		return "", fmt.Errorf("marshal terminal grant: %w", err)
	}

	key, err := deriveKey(secret)
	if err != nil {
		return "", err
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
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return "", fmt.Errorf("generate nonce: %w", err)
	}

	ciphertext := gcm.Seal(nil, iv, payload, nil)
	tagStart := len(ciphertext) - gcm.Overhead()
	envelope, err := json.Marshal(tokenEnvelope{
		IV:    base64.StdEncoding.EncodeToString(iv),
		Value: base64.StdEncoding.EncodeToString(ciphertext[:tagStart]),
		Tag:   base64.StdEncoding.EncodeToString(ciphertext[tagStart:]),
	})
	if err != nil {
		return "", fmt.Errorf("marshal token envelope: %w", err)
	}

	return base64.StdEncoding.EncodeToString(envelope), nil
}

func ValidateGrant(secret, token string, now time.Time) (contracts.TerminalSessionGrant, error) {
	if strings.TrimSpace(token) == "" {
		return contracts.TerminalSessionGrant{}, errors.New("token is required")
	}

	key, err := deriveKey(secret)
	if err != nil {
		return contracts.TerminalSessionGrant{}, err
	}

	rawEnvelope, err := base64.StdEncoding.DecodeString(token)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode token envelope: %w", err)
	}

	var envelope tokenEnvelope
	if err := json.Unmarshal(rawEnvelope, &envelope); err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode token envelope json: %w", err)
	}

	iv, err := base64.StdEncoding.DecodeString(envelope.IV)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode token iv: %w", err)
	}
	ciphertext, err := base64.StdEncoding.DecodeString(envelope.Value)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode token ciphertext: %w", err)
	}
	tag, err := base64.StdEncoding.DecodeString(envelope.Tag)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode token tag: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("create gcm: %w", err)
	}

	plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decrypt token: %w", err)
	}

	var grant contracts.TerminalSessionGrant
	if err := json.Unmarshal(plaintext, &grant); err != nil {
		return contracts.TerminalSessionGrant{}, fmt.Errorf("decode terminal grant: %w", err)
	}

	normalized, err := normalizeGrant(grant)
	if err != nil {
		return contracts.TerminalSessionGrant{}, err
	}
	if !normalized.ExpiresAt.After(now.UTC()) {
		return contracts.TerminalSessionGrant{}, errors.New("terminal grant has expired")
	}

	return normalized, nil
}

func DescribeGrant(grant contracts.TerminalSessionGrant) contracts.TerminalSessionGrantSummary {
	summary := contracts.TerminalSessionGrantSummary{
		SessionID:    grant.SessionID,
		ConnectionID: grant.ConnectionID,
		UserID:       grant.UserID,
		ExpiresAt:    grant.ExpiresAt,
		Target:       describeEndpoint(grant.Target),
		Terminal:     grant.Terminal,
		Metadata:     grant.Metadata,
	}
	if grant.Bastion != nil {
		bastion := describeEndpoint(*grant.Bastion)
		summary.Bastion = &bastion
	}
	return summary
}

func ProtocolDescriptor() contracts.TerminalProtocolDescriptor {
	return contracts.TerminalProtocolDescriptor{
		WebSocketPath: "/ws/terminal",
		ClientMessages: []string{
			`{"type":"input","data":"echo hello\n"}`,
			`{"type":"resize","cols":120,"rows":32}`,
			`{"type":"ping"}`,
			`{"type":"close"}`,
		},
		ServerMessages: []string{
			`{"type":"ready"}`,
			`{"type":"data","data":"shell output"}`,
			`{"type":"pong"}`,
			`{"type":"closed"}`,
			`{"type":"error","code":"CONNECTION_ERROR","message":"connection failed"}`,
		},
		DefaultTerminal: contracts.TerminalSettings{
			Term: "xterm-256color",
			Cols: 80,
			Rows: 24,
		},
	}
}

func normalizeGrant(grant contracts.TerminalSessionGrant) (contracts.TerminalSessionGrant, error) {
	if strings.TrimSpace(grant.Target.Host) == "" {
		return contracts.TerminalSessionGrant{}, errors.New("target.host is required")
	}
	if grant.Target.Port <= 0 {
		grant.Target.Port = 22
	}
	if strings.TrimSpace(grant.Target.Username) == "" {
		return contracts.TerminalSessionGrant{}, errors.New("target.username is required")
	}
	if strings.TrimSpace(grant.Target.Password) == "" && strings.TrimSpace(grant.Target.PrivateKey) == "" {
		return contracts.TerminalSessionGrant{}, errors.New("target credentials are required")
	}
	if grant.Bastion != nil {
		if strings.TrimSpace(grant.Bastion.Host) == "" {
			return contracts.TerminalSessionGrant{}, errors.New("bastion.host is required")
		}
		if grant.Bastion.Port <= 0 {
			grant.Bastion.Port = 22
		}
		if strings.TrimSpace(grant.Bastion.Username) == "" {
			return contracts.TerminalSessionGrant{}, errors.New("bastion.username is required")
		}
		if strings.TrimSpace(grant.Bastion.Password) == "" && strings.TrimSpace(grant.Bastion.PrivateKey) == "" {
			return contracts.TerminalSessionGrant{}, errors.New("bastion credentials are required")
		}
	}
	if grant.ExpiresAt.IsZero() {
		grant.ExpiresAt = time.Now().UTC().Add(5 * time.Minute)
	}
	grant.ExpiresAt = grant.ExpiresAt.UTC()
	if strings.TrimSpace(grant.Terminal.Term) == "" {
		grant.Terminal.Term = "xterm-256color"
	}
	if grant.Terminal.Cols <= 0 {
		grant.Terminal.Cols = 80
	}
	if grant.Terminal.Rows <= 0 {
		grant.Terminal.Rows = 24
	}
	if grant.Metadata == nil {
		grant.Metadata = map[string]string{}
	}
	return grant, nil
}

func deriveKey(secret string) ([]byte, error) {
	if strings.TrimSpace(secret) == "" {
		return nil, errors.New("terminal broker secret is required")
	}
	key, err := scrypt.Key([]byte(secret), []byte(terminalGrantSalt), 16384, 8, 1, 32)
	if err != nil {
		return nil, fmt.Errorf("derive terminal broker key: %w", err)
	}
	return key, nil
}

func describeEndpoint(endpoint contracts.TerminalEndpoint) contracts.TerminalEndpointSummary {
	return contracts.TerminalEndpointSummary{
		Host:          endpoint.Host,
		Port:          endpoint.Port,
		Username:      endpoint.Username,
		HasPassword:   strings.TrimSpace(endpoint.Password) != "",
		HasPrivateKey: strings.TrimSpace(endpoint.PrivateKey) != "",
	}
}
