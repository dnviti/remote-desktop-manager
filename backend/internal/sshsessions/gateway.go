package sshsessions

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) resolveBastion(ctx context.Context, claims authn.Claims, access connectionAccess) (map[string]any, string, error) {
	if access.Connection.GatewayID == nil || strings.TrimSpace(*access.Connection.GatewayID) == "" {
		return nil, "", nil
	}

	gateway, err := s.loadGateway(ctx, *access.Connection.GatewayID)
	if err != nil {
		return nil, "", err
	}
	switch gateway.Type {
	case "SSH_BASTION", "MANAGED_SSH":
	default:
		return nil, "", &requestError{status: http.StatusBadRequest, message: "Connection gateway must be SSH_BASTION or MANAGED_SSH for SSH connections"}
	}

	host := gateway.Host
	port := gateway.Port
	if gateway.TunnelEnabled {
		proxy, err := s.createTunnelProxy(ctx, gateway.ID, "127.0.0.1", port)
		if err != nil {
			return nil, "", err
		}
		host = proxy.Host
		port = proxy.Port
	}

	if gateway.Type == "MANAGED_SSH" {
		privateKey, err := s.loadTenantPrivateKey(ctx, gateway.TenantID)
		if err != nil {
			return nil, "", err
		}
		return map[string]any{
			"host":       host,
			"port":       port,
			"username":   "tunnel",
			"privateKey": privateKey,
		}, gateway.ID, nil
	}

	credentials, err := s.loadGatewayCredentials(ctx, claims.UserID, gateway)
	if err != nil {
		return nil, "", err
	}

	bastion := map[string]any{
		"host":     host,
		"port":     port,
		"username": credentials.Username,
	}
	if credentials.Password != "" {
		bastion["password"] = credentials.Password
	}
	if credentials.PrivateKey != "" {
		bastion["privateKey"] = credentials.PrivateKey
	}
	return bastion, gateway.ID, nil
}

func (s Service) loadGateway(ctx context.Context, gatewayID string) (gatewayRecord, error) {
	var record gatewayRecord
	if err := s.DB.QueryRow(ctx, `
SELECT
	id,
	type::text,
	host,
	port,
	"tenantId",
	"isManaged",
	"tunnelEnabled",
	"encryptedUsername",
	"usernameIV",
	"usernameTag",
	"encryptedPassword",
	"passwordIV",
	"passwordTag",
	"encryptedSshKey",
	"sshKeyIV",
	"sshKeyTag"
FROM "Gateway"
WHERE id = $1
`, gatewayID).Scan(
		&record.ID,
		&record.Type,
		&record.Host,
		&record.Port,
		&record.TenantID,
		&record.IsManaged,
		&record.TunnelEnabled,
		&record.EncryptedUsername,
		&record.UsernameIV,
		&record.UsernameTag,
		&record.EncryptedPassword,
		&record.PasswordIV,
		&record.PasswordTag,
		&record.EncryptedSSHKey,
		&record.SSHKeyIV,
		&record.SSHKeyTag,
	); err != nil {
		return gatewayRecord{}, fmt.Errorf("load gateway: %w", err)
	}
	return record, nil
}

func (s Service) loadGatewayCredentials(ctx context.Context, userID string, gateway gatewayRecord) (resolvedCredentials, error) {
	key, _, err := s.getUserMasterKey(ctx, userID)
	if err != nil {
		return resolvedCredentials{}, err
	}
	if len(key) == 0 {
		return resolvedCredentials{}, &requestError{status: 403, message: "Vault is locked. Please unlock it first."}
	}
	defer zeroBytes(key)

	if gateway.EncryptedUsername == nil || gateway.UsernameIV == nil || gateway.UsernameTag == nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway."}
	}
	username, err := decryptEncryptedField(key, encryptedField{
		Ciphertext: *gateway.EncryptedUsername,
		IV:         *gateway.UsernameIV,
		Tag:        *gateway.UsernameTag,
	})
	if err != nil {
		return resolvedCredentials{}, &requestError{status: 400, message: "Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway."}
	}

	result := resolvedCredentials{Username: username}
	if gateway.EncryptedPassword != nil && gateway.PasswordIV != nil && gateway.PasswordTag != nil {
		password, err := decryptEncryptedField(key, encryptedField{
			Ciphertext: *gateway.EncryptedPassword,
			IV:         *gateway.PasswordIV,
			Tag:        *gateway.PasswordTag,
		})
		if err == nil {
			result.Password = password
		}
	}
	if gateway.EncryptedSSHKey != nil && gateway.SSHKeyIV != nil && gateway.SSHKeyTag != nil {
		privateKey, err := decryptEncryptedField(key, encryptedField{
			Ciphertext: *gateway.EncryptedSSHKey,
			IV:         *gateway.SSHKeyIV,
			Tag:        *gateway.SSHKeyTag,
		})
		if err == nil {
			result.PrivateKey = privateKey
		}
	}
	if result.Password == "" && result.PrivateKey == "" {
		return resolvedCredentials{}, &requestError{status: 400, message: "Gateway credentials are incomplete. Please configure username and password or SSH key on the gateway."}
	}
	return result, nil
}

func (s Service) loadTenantPrivateKey(ctx context.Context, tenantID string) (string, error) {
	if len(s.ServerEncryptionKey) == 0 {
		return "", fmt.Errorf("server encryption key is unavailable")
	}
	var field encryptedField
	if err := s.DB.QueryRow(ctx, `
SELECT "encryptedPrivateKey", "privateKeyIV", "privateKeyTag"
FROM "SshKeyPair"
WHERE "tenantId" = $1
`, tenantID).Scan(&field.Ciphertext, &field.IV, &field.Tag); err != nil {
		return "", fmt.Errorf("load tenant SSH key pair: %w", err)
	}
	privateKey, err := decryptEncryptedField(s.ServerEncryptionKey, field)
	if err != nil {
		return "", fmt.Errorf("decrypt tenant SSH key pair: %w", err)
	}
	return privateKey, nil
}

func (s Service) createTunnelProxy(ctx context.Context, gatewayID, targetHost string, targetPort int) (tunnelProxyResponse, error) {
	body, err := json.Marshal(map[string]any{
		"gatewayId":  gatewayID,
		"targetHost": targetHost,
		"targetPort": targetPort,
	})
	if err != nil {
		return tunnelProxyResponse{}, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(s.tunnelBrokerURL(), "/")+"/v1/tcp-proxies", bytes.NewReader(body))
	if err != nil {
		return tunnelProxyResponse{}, err
	}
	req.Header.Set("content-type", "application/json")

	resp, err := s.client().Do(req)
	if err != nil {
		return tunnelProxyResponse{}, fmt.Errorf("create tunnel proxy: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		var payload map[string]any
		if json.NewDecoder(resp.Body).Decode(&payload) == nil {
			if message, _ := payload["error"].(string); strings.TrimSpace(message) != "" {
				return tunnelProxyResponse{}, &requestError{status: http.StatusServiceUnavailable, message: message}
			}
		}
		return tunnelProxyResponse{}, &requestError{status: http.StatusServiceUnavailable, message: "Gateway tunnel is disconnected — the gateway may be unreachable"}
	}

	var proxy tunnelProxyResponse
	if err := json.NewDecoder(resp.Body).Decode(&proxy); err != nil {
		return tunnelProxyResponse{}, fmt.Errorf("decode tunnel proxy response: %w", err)
	}
	return proxy, nil
}
