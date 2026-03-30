package externalvaultapi

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

type providerTestPayload struct {
	SecretPath string `json:"secretPath"`
}

type providerTestResult struct {
	Success bool     `json:"success"`
	Keys    []string `json:"keys,omitempty"`
	Error   string   `json:"error,omitempty"`
}

func (s Service) HandleTest(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload providerTestPayload
	if r.ContentLength != 0 {
		if err := app.ReadJSON(r, &payload); err != nil {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}
	}

	result, err := s.TestConnection(r.Context(), claims, r.PathValue("providerId"), payload.SecretPath)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) TestConnection(ctx context.Context, claims authn.Claims, providerID, secretPath string) (providerTestResult, error) {
	record, err := s.getProvider(ctx, claims.TenantID, providerID)
	if err != nil {
		return providerTestResult{}, err
	}

	result := providerTestResult{Success: false}
	switch record.ProviderType {
	case "HASHICORP_VAULT":
		switch record.AuthMethod {
		case "TOKEN":
			var auth struct {
				Token string `json:"token"`
			}
			rawAuth, err := decryptValue(s.ServerEncryptionKey, record.EncryptedAuthPayload, record.AuthPayloadIV, record.AuthPayloadTag)
			if err != nil {
				result.Error = "failed to decrypt auth payload"
				break
			}
			if err := json.Unmarshal([]byte(rawAuth), &auth); err != nil || strings.TrimSpace(auth.Token) == "" {
				result.Error = "invalid auth payload"
				break
			}
			result = testHashiCorpVault(record, auth.Token)
		default:
			result.Error = fmt.Sprintf("native provider test not yet implemented for authMethod %s", record.AuthMethod)
		}
	default:
		result.Error = fmt.Sprintf("native provider test not yet implemented for providerType %s", record.ProviderType)
	}

	details := map[string]any{
		"secretPath": strings.TrimSpace(secretPath),
		"success":    result.Success,
	}
	if result.Error != "" {
		details["error"] = result.Error
	}
	if err := s.insertAuditLog(ctx, claims.UserID, "VAULT_PROVIDER_TEST", providerID, details); err != nil {
		return providerTestResult{}, fmt.Errorf("insert provider test audit log: %w", err)
	}

	return result, nil
}

func testHashiCorpVault(record providerRecord, token string) providerTestResult {
	statusURL := strings.TrimRight(record.ServerURL, "/") + "/v1/sys/health"
	client := &http.Client{
		Timeout: 10 * time.Second,
		Transport: &http.Transport{
			TLSClientConfig: buildProviderTLSConfig(record.CACertificate),
		},
	}

	req, err := http.NewRequest(http.MethodGet, statusURL, nil)
	if err != nil {
		return providerTestResult{Success: false, Error: err.Error()}
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Vault-Token", token)

	resp, err := client.Do(req)
	if err != nil {
		return providerTestResult{Success: false, Error: err.Error()}
	}
	defer resp.Body.Close()
	io.Copy(io.Discard, resp.Body)

	// Vault health returns a range of non-5xx codes for healthy but special states.
	if resp.StatusCode >= 200 && resp.StatusCode < 500 {
		return providerTestResult{Success: true}
	}
	return providerTestResult{Success: false, Error: fmt.Sprintf("vault returned HTTP %d", resp.StatusCode)}
}

func buildProviderTLSConfig(caCertificate *string) *tls.Config {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12}
	if caCertificate == nil || strings.TrimSpace(*caCertificate) == "" {
		return cfg
	}
	pool := x509.NewCertPool()
	if pool.AppendCertsFromPEM([]byte(*caCertificate)) {
		cfg.RootCAs = pool
	}
	return cfg
}

func decryptValue(key []byte, ciphertextHex, ivHex, tagHex string) (string, error) {
	ciphertext, err := hex.DecodeString(strings.TrimSpace(ciphertextHex))
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	iv, err := hex.DecodeString(strings.TrimSpace(ivHex))
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	tag, err := hex.DecodeString(strings.TrimSpace(tagHex))
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", fmt.Errorf("create gcm: %w", err)
	}
	plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", fmt.Errorf("decrypt auth payload: %w", err)
	}
	return string(plaintext), nil
}
