package connections

import (
	"encoding/json"
	"net"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
)

func parseCreatePayload(r *http.Request) (createPayload, error) {
	var payload createPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return createPayload{}, err
	}
	return payload, nil
}

func parseUpdatePayload(r *http.Request) (updatePayload, error) {
	var payload updatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return updatePayload{}, err
	}
	return payload, nil
}

func presentUpdateFields(payload updatePayload) []string {
	fields := make([]string, 0, 20)
	add := func(name string, present bool) {
		if present {
			fields = append(fields, name)
		}
	}
	add("name", payload.Name.Present)
	add("type", payload.Type.Present)
	add("host", payload.Host.Present)
	add("port", payload.Port.Present)
	add("username", payload.Username.Present)
	add("password", payload.Password.Present)
	add("domain", payload.Domain.Present)
	add("credentialSecretId", payload.CredentialSecretID.Present)
	add("externalVaultProviderId", payload.ExternalVaultProviderID.Present)
	add("externalVaultPath", payload.ExternalVaultPath.Present)
	add("description", payload.Description.Present)
	add("folderId", payload.FolderID.Present)
	add("enableDrive", payload.EnableDrive.Present)
	add("gatewayId", payload.GatewayID.Present)
	add("sshTerminalConfig", payload.SSHTerminalConfig.Present)
	add("rdpSettings", payload.RDPSettings.Present)
	add("vncSettings", payload.VNCSettings.Present)
	add("dbSettings", payload.DBSettings.Present)
	add("defaultCredentialMode", payload.DefaultCredentialMode.Present)
	add("dlpPolicy", payload.DLPPolicy.Present)
	add("transferRetentionPolicy", payload.TransferRetentionPolicy.Present)
	add("bastionConnectionId", payload.BastionConnectionID.Present)
	add("targetDbHost", payload.TargetDBHost.Present)
	add("targetDbPort", payload.TargetDBPort.Present)
	add("dbType", payload.DBType.Present)
	return fields
}

type transferRetentionPolicy struct {
	RetainSuccessfulUploads bool `json:"retainSuccessfulUploads"`
	MaxUploadSizeBytes      int64 `json:"maxUploadSizeBytes"`
}

type transferRetentionPolicyInput struct {
	RetainSuccessfulUploads *bool `json:"retainSuccessfulUploads"`
	MaxUploadSizeBytes      *int64 `json:"maxUploadSizeBytes"`
}

const defaultConnectionUploadMaxBytes = 100 * 1024 * 1024

func ResolveTransferRetentionPolicy(value []byte) json.RawMessage {
	normalized, err := normalizeTransferRetentionPolicyDocument(value)
	if err != nil {
		return transferRetentionPolicyJSON(false, defaultConnectionUploadMaxBytes)
	}
	return normalized
}

func normalizeTransferRetentionPolicyInput(value json.RawMessage) (json.RawMessage, error) {
	if len(value) == 0 || string(value) == "null" {
		return nil, nil
	}
	return normalizeTransferRetentionPolicyDocument(value)
}

func normalizeTransferRetentionPolicyDocument(value []byte) (json.RawMessage, error) {
	if len(value) == 0 || string(value) == "null" {
		return transferRetentionPolicyJSON(false, defaultConnectionUploadMaxBytes), nil
	}

	var payload transferRetentionPolicyInput
	if err := json.Unmarshal(value, &payload); err != nil {
		return nil, &requestError{status: 400, message: "transferRetentionPolicy must be a JSON object"}
	}
	if payload.MaxUploadSizeBytes != nil && *payload.MaxUploadSizeBytes < 1 {
		return nil, &requestError{status: 400, message: "transferRetentionPolicy.maxUploadSizeBytes must be a positive number"}
	}
	if payload.MaxUploadSizeBytes != nil && *payload.MaxUploadSizeBytes > defaultConnectionUploadMaxBytes {
		return nil, &requestError{status: 400, message: "transferRetentionPolicy.maxUploadSizeBytes cannot exceed 104857600"}
	}

	return transferRetentionPolicyJSON(
		boolOrDefault(payload.RetainSuccessfulUploads, false),
		int64OrDefault(payload.MaxUploadSizeBytes, defaultConnectionUploadMaxBytes),
	), nil
}

func transferRetentionPolicyJSON(retainSuccessfulUploads bool, maxUploadSizeBytes int64) json.RawMessage {
	raw, _ := json.Marshal(transferRetentionPolicy{
		RetainSuccessfulUploads: retainSuccessfulUploads,
		MaxUploadSizeBytes:      maxUploadSizeBytes,
	})
	return raw
}

func normalizeRawJSON(value []byte) json.RawMessage {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	return json.RawMessage(value)
}

func nullableString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}

func nullableInt(value *int) any {
	if value == nil {
		return nil
	}
	return *value
}

func normalizeOptionalStringPtrValue(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}

func nullableJSON(value json.RawMessage) any {
	if len(value) == 0 || string(value) == "null" {
		return nil
	}
	return []byte(value)
}

func boolOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func int64OrDefault(value *int64, fallback int64) int64 {
	if value == nil {
		return fallback
	}
	return *value
}

func nullCiphertext(field *encryptedField) any {
	if field == nil {
		return nil
	}
	return field.Ciphertext
}

func nullIV(field *encryptedField) any {
	if field == nil {
		return nil
	}
	return field.IV
}

func nullTag(field *encryptedField) any {
	if field == nil {
		return nil
	}
	return field.Tag
}

func validConnectionType(value string) bool {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "RDP", "SSH", "VNC", "DATABASE", "DB_TUNNEL":
		return true
	default:
		return false
	}
}

func canManageTeam(role string) bool {
	switch role {
	case "TEAM_ADMIN", "TEAM_EDITOR":
		return true
	default:
		return false
	}
}

func requestIP(r *http.Request) *string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		if value := strings.TrimSpace(r.Header.Get(header)); value != "" {
			if header == "X-Forwarded-For" {
				value = strings.TrimSpace(strings.Split(value, ",")[0])
			}
			host := stripPort(value)
			if host != "" {
				return &host
			}
		}
	}
	host := stripPort(r.RemoteAddr)
	if host == "" {
		return nil
	}
	return &host
}

func stripPort(value string) string {
	if host, _, err := net.SplitHostPort(value); err == nil {
		return host
	}
	return strings.TrimSpace(value)
}
