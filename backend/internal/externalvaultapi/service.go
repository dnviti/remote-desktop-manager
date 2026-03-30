package externalvaultapi

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
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

var allowedAuthMethods = map[string]map[string]struct{}{
	"HASHICORP_VAULT": {
		"TOKEN":   {},
		"APPROLE": {},
	},
	"AWS_SECRETS_MANAGER": {
		"IAM_ACCESS_KEY": {},
		"IAM_ROLE":       {},
	},
	"AZURE_KEY_VAULT": {
		"CLIENT_CREDENTIALS": {},
		"MANAGED_IDENTITY":   {},
	},
	"GCP_SECRET_MANAGER": {
		"SERVICE_ACCOUNT_KEY": {},
		"WORKLOAD_IDENTITY":   {},
	},
	"CYBERARK_CONJUR": {
		"CONJUR_API_KEY":   {},
		"CONJUR_AUTHN_K8S": {},
	},
}

type Service struct {
	DB                  *pgxpool.Pool
	ServerEncryptionKey []byte
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type providerResponse struct {
	ID              string    `json:"id"`
	Name            string    `json:"name"`
	ProviderType    string    `json:"providerType"`
	ServerURL       string    `json:"serverUrl"`
	AuthMethod      string    `json:"authMethod"`
	Namespace       *string   `json:"namespace"`
	MountPath       string    `json:"mountPath"`
	CacheTTLSeconds int       `json:"cacheTtlSeconds"`
	Enabled         bool      `json:"enabled"`
	CreatedAt       time.Time `json:"createdAt"`
	UpdatedAt       time.Time `json:"updatedAt"`
	CACertificate   *string   `json:"caCertificate,omitempty"`
	HasAuthPayload  bool      `json:"hasApiToken,omitempty"`
}

type providerRecord struct {
	ID                   string
	Name                 string
	ProviderType         string
	ServerURL            string
	AuthMethod           string
	Namespace            *string
	MountPath            string
	EncryptedAuthPayload string
	AuthPayloadIV        string
	AuthPayloadTag       string
	CACertificate        *string
	CacheTTLSeconds      int
	Enabled              bool
	CreatedAt            time.Time
	UpdatedAt            time.Time
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	items, err := s.listProviders(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleGet(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	item, err := s.getProvider(r.Context(), claims.TenantID, r.PathValue("providerId"))
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, toProviderResponse(item, true))
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload providerCreatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.createProvider(r.Context(), claims, payload)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) HandleUpdate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	var payload providerUpdatePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	result, err := s.updateProvider(r.Context(), claims, r.PathValue("providerId"), payload)
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

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireTenantAdmin(claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.deleteProvider(r.Context(), claims, r.PathValue("providerId")); err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

type providerCreatePayload struct {
	Name            string  `json:"name"`
	ProviderType    string  `json:"providerType"`
	ServerURL       string  `json:"serverUrl"`
	AuthMethod      string  `json:"authMethod"`
	Namespace       *string `json:"namespace"`
	MountPath       *string `json:"mountPath"`
	AuthPayload     string  `json:"authPayload"`
	CACertificate   *string `json:"caCertificate"`
	CacheTTLSeconds *int    `json:"cacheTtlSeconds"`
}

type providerUpdatePayload struct {
	Name            *string `json:"name"`
	ProviderType    *string `json:"providerType"`
	ServerURL       *string `json:"serverUrl"`
	AuthMethod      *string `json:"authMethod"`
	Namespace       *string `json:"namespace"`
	MountPath       *string `json:"mountPath"`
	AuthPayload     *string `json:"authPayload"`
	CACertificate   *string `json:"caCertificate"`
	CacheTTLSeconds *int    `json:"cacheTtlSeconds"`
	Enabled         *bool   `json:"enabled"`
}

func (s Service) createProvider(ctx context.Context, claims authn.Claims, payload providerCreatePayload) (providerResponse, error) {
	normalized, encryptedAuth, err := s.normalizeCreatePayload(payload)
	if err != nil {
		return providerResponse{}, err
	}

	record := providerRecord{}
	row := s.DB.QueryRow(ctx, `
INSERT INTO "ExternalVaultProvider" (
	id,
	"tenantId",
	name,
	"providerType",
	"serverUrl",
	"authMethod",
	namespace,
	"mountPath",
	"encryptedAuthPayload",
	"authPayloadIV",
	"authPayloadTag",
	"caCertificate",
	"cacheTtlSeconds",
	enabled,
	"createdAt",
	"updatedAt"
) VALUES (
	$1,$2,$3,$4::"ExternalVaultType",$5,$6::"ExternalVaultAuthMethod",$7,$8,$9,$10,$11,$12,$13,true,NOW(),NOW()
)
RETURNING id,name,"providerType"::text,"serverUrl","authMethod"::text,namespace,"mountPath","encryptedAuthPayload","authPayloadIV","authPayloadTag","caCertificate","cacheTtlSeconds",enabled,"createdAt","updatedAt"
`, uuid.NewString(), claims.TenantID, normalized.Name, normalized.ProviderType, normalized.ServerURL, normalized.AuthMethod, normalized.Namespace, normalized.MountPath, encryptedAuth.Ciphertext, encryptedAuth.IV, encryptedAuth.Tag, normalized.CACertificate, normalized.CacheTTLSeconds)
	if err := scanProvider(row, &record); err != nil {
		if strings.Contains(err.Error(), "duplicate key") {
			return providerResponse{}, &requestError{status: http.StatusConflict, message: "A vault provider with this name already exists"}
		}
		return providerResponse{}, fmt.Errorf("create external vault provider: %w", err)
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "VAULT_PROVIDER_CREATE", record.ID, map[string]any{
		"name":         record.Name,
		"providerType": record.ProviderType,
		"serverUrl":    record.ServerURL,
		"authMethod":   record.AuthMethod,
	}); err != nil {
		return providerResponse{}, fmt.Errorf("insert create audit log: %w", err)
	}

	return toProviderResponse(record, false), nil
}

func (s Service) updateProvider(ctx context.Context, claims authn.Claims, providerID string, payload providerUpdatePayload) (providerResponse, error) {
	existing, err := s.getProvider(ctx, claims.TenantID, providerID)
	if err != nil {
		return providerResponse{}, err
	}

	normalized, encryptedAuth, changedFields, err := s.normalizeUpdatePayload(existing, payload)
	if err != nil {
		return providerResponse{}, err
	}
	if len(changedFields) == 0 {
		return toProviderResponse(existing, false), nil
	}

	record := providerRecord{}
	row := s.DB.QueryRow(ctx, `
UPDATE "ExternalVaultProvider"
SET
	name = $3,
	"providerType" = $4::"ExternalVaultType",
	"serverUrl" = $5,
	"authMethod" = $6::"ExternalVaultAuthMethod",
	namespace = $7,
	"mountPath" = $8,
	"encryptedAuthPayload" = $9,
	"authPayloadIV" = $10,
	"authPayloadTag" = $11,
	"caCertificate" = $12,
	"cacheTtlSeconds" = $13,
	enabled = $14,
	"updatedAt" = NOW()
WHERE id = $1 AND "tenantId" = $2
RETURNING id,name,"providerType"::text,"serverUrl","authMethod"::text,namespace,"mountPath","encryptedAuthPayload","authPayloadIV","authPayloadTag","caCertificate","cacheTtlSeconds",enabled,"createdAt","updatedAt"
`, providerID, claims.TenantID, normalized.Name, normalized.ProviderType, normalized.ServerURL, normalized.AuthMethod, normalized.Namespace, normalized.MountPath, encryptedAuth.Ciphertext, encryptedAuth.IV, encryptedAuth.Tag, normalized.CACertificate, normalized.CacheTTLSeconds, normalized.Enabled)
	if err := scanProvider(row, &record); err != nil {
		if errors.Is(err, pgx.ErrNoRows) || strings.Contains(err.Error(), "no rows") {
			return providerResponse{}, &requestError{status: http.StatusNotFound, message: "Vault provider not found"}
		}
		return providerResponse{}, fmt.Errorf("update external vault provider: %w", err)
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "VAULT_PROVIDER_UPDATE", record.ID, map[string]any{
		"changes": changedFields,
	}); err != nil {
		return providerResponse{}, fmt.Errorf("insert update audit log: %w", err)
	}

	return toProviderResponse(record, false), nil
}

func (s Service) deleteProvider(ctx context.Context, claims authn.Claims, providerID string) error {
	record, err := s.getProvider(ctx, claims.TenantID, providerID)
	if err != nil {
		return err
	}

	if _, err := s.DB.Exec(ctx, `
UPDATE "Connection"
SET "externalVaultProviderId" = NULL, "externalVaultPath" = NULL
WHERE "externalVaultProviderId" = $1
`, providerID); err != nil {
		return fmt.Errorf("clear provider connections: %w", err)
	}

	if _, err := s.DB.Exec(ctx, `DELETE FROM "ExternalVaultProvider" WHERE id = $1 AND "tenantId" = $2`, providerID, claims.TenantID); err != nil {
		return fmt.Errorf("delete external vault provider: %w", err)
	}

	if err := s.insertAuditLog(ctx, claims.UserID, "VAULT_PROVIDER_DELETE", providerID, map[string]any{
		"name": record.Name,
	}); err != nil {
		return fmt.Errorf("insert delete audit log: %w", err)
	}
	return nil
}

func (s Service) listProviders(ctx context.Context, tenantID string) ([]providerResponse, error) {
	rows, err := s.DB.Query(ctx, `
SELECT id,name,"providerType"::text,"serverUrl","authMethod"::text,namespace,"mountPath","encryptedAuthPayload","authPayloadIV","authPayloadTag","caCertificate","cacheTtlSeconds",enabled,"createdAt","updatedAt"
FROM "ExternalVaultProvider"
WHERE "tenantId" = $1
ORDER BY name ASC
`, tenantID)
	if err != nil {
		return nil, fmt.Errorf("list external vault providers: %w", err)
	}
	defer rows.Close()

	items := make([]providerResponse, 0)
	for rows.Next() {
		var record providerRecord
		if err := scanProvider(rows, &record); err != nil {
			return nil, fmt.Errorf("scan external vault provider: %w", err)
		}
		items = append(items, toProviderResponse(record, false))
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate external vault providers: %w", err)
	}
	return items, nil
}

func (s Service) getProvider(ctx context.Context, tenantID, providerID string) (providerRecord, error) {
	row := s.DB.QueryRow(ctx, `
SELECT id,name,"providerType"::text,"serverUrl","authMethod"::text,namespace,"mountPath","encryptedAuthPayload","authPayloadIV","authPayloadTag","caCertificate","cacheTtlSeconds",enabled,"createdAt","updatedAt"
FROM "ExternalVaultProvider"
WHERE id = $1 AND "tenantId" = $2
`, providerID, tenantID)

	var record providerRecord
	if err := scanProvider(row, &record); err != nil {
		if errors.Is(err, pgx.ErrNoRows) || strings.Contains(err.Error(), "no rows") {
			return providerRecord{}, &requestError{status: http.StatusNotFound, message: "Vault provider not found"}
		}
		return providerRecord{}, fmt.Errorf("get external vault provider: %w", err)
	}
	return record, nil
}

type normalizedPayload struct {
	Name            string
	ProviderType    string
	ServerURL       string
	AuthMethod      string
	Namespace       *string
	MountPath       string
	AuthPayload     string
	CACertificate   *string
	CacheTTLSeconds int
	Enabled         bool
}

type encryptedField struct {
	Ciphertext string
	IV         string
	Tag        string
}

func (s Service) normalizeCreatePayload(payload providerCreatePayload) (normalizedPayload, encryptedField, error) {
	normalized := normalizedPayload{
		Name:            strings.TrimSpace(payload.Name),
		ProviderType:    strings.ToUpper(strings.TrimSpace(defaultString(payload.ProviderType, "HASHICORP_VAULT"))),
		ServerURL:       strings.TrimSpace(payload.ServerURL),
		AuthMethod:      strings.ToUpper(strings.TrimSpace(payload.AuthMethod)),
		Namespace:       normalizeOptional(payload.Namespace),
		MountPath:       strings.TrimSpace(defaultOptional(payload.MountPath, "secret")),
		AuthPayload:     strings.TrimSpace(payload.AuthPayload),
		CACertificate:   normalizeOptional(payload.CACertificate),
		CacheTTLSeconds: defaultInt(payload.CacheTTLSeconds, 300),
		Enabled:         true,
	}
	if err := validateNormalized(normalized.ProviderType, normalized.AuthMethod, normalized.ServerURL, normalized.AuthPayload, normalized.CacheTTLSeconds); err != nil {
		return normalizedPayload{}, encryptedField{}, err
	}
	encryptedAuth, err := encryptValue(s.ServerEncryptionKey, normalized.AuthPayload)
	if err != nil {
		return normalizedPayload{}, encryptedField{}, fmt.Errorf("encrypt auth payload: %w", err)
	}
	return normalized, encryptedAuth, nil
}

func (s Service) normalizeUpdatePayload(existing providerRecord, payload providerUpdatePayload) (normalizedPayload, encryptedField, []string, error) {
	normalized := normalizedPayload{
		Name:            existing.Name,
		ProviderType:    existing.ProviderType,
		ServerURL:       existing.ServerURL,
		AuthMethod:      existing.AuthMethod,
		Namespace:       existing.Namespace,
		MountPath:       existing.MountPath,
		AuthPayload:     "",
		CACertificate:   existing.CACertificate,
		CacheTTLSeconds: existing.CacheTTLSeconds,
		Enabled:         existing.Enabled,
	}
	encrypted := encryptedField{
		Ciphertext: existing.EncryptedAuthPayload,
		IV:         existing.AuthPayloadIV,
		Tag:        existing.AuthPayloadTag,
	}
	changed := make([]string, 0)

	if payload.Name != nil {
		normalized.Name = strings.TrimSpace(*payload.Name)
		changed = append(changed, "name")
	}
	if payload.ProviderType != nil {
		normalized.ProviderType = strings.ToUpper(strings.TrimSpace(*payload.ProviderType))
		changed = append(changed, "providerType")
	}
	if payload.ServerURL != nil {
		normalized.ServerURL = strings.TrimSpace(*payload.ServerURL)
		changed = append(changed, "serverUrl")
	}
	if payload.AuthMethod != nil {
		normalized.AuthMethod = strings.ToUpper(strings.TrimSpace(*payload.AuthMethod))
		changed = append(changed, "authMethod")
	}
	if payload.Namespace != nil {
		normalized.Namespace = normalizeOptional(payload.Namespace)
		changed = append(changed, "namespace")
	}
	if payload.MountPath != nil {
		normalized.MountPath = strings.TrimSpace(*payload.MountPath)
		changed = append(changed, "mountPath")
	}
	if payload.CACertificate != nil {
		normalized.CACertificate = normalizeOptional(payload.CACertificate)
		changed = append(changed, "caCertificate")
	}
	if payload.CacheTTLSeconds != nil {
		normalized.CacheTTLSeconds = *payload.CacheTTLSeconds
		changed = append(changed, "cacheTtlSeconds")
	}
	if payload.Enabled != nil {
		normalized.Enabled = *payload.Enabled
		changed = append(changed, "enabled")
	}
	if payload.AuthPayload != nil {
		normalized.AuthPayload = strings.TrimSpace(*payload.AuthPayload)
		var err error
		encrypted, err = encryptValue(s.ServerEncryptionKey, normalized.AuthPayload)
		if err != nil {
			return normalizedPayload{}, encryptedField{}, nil, fmt.Errorf("encrypt auth payload: %w", err)
		}
		changed = append(changed, "authPayload")
	}

	if normalized.AuthPayload == "" {
		normalized.AuthPayload = "{}"
	}
	if err := validateNormalized(normalized.ProviderType, normalized.AuthMethod, normalized.ServerURL, normalized.AuthPayload, normalized.CacheTTLSeconds); err != nil {
		if payload.AuthPayload == nil {
			// Only validate the structural pairing when payload itself was not updated.
			if _, ok := err.(*requestError); ok {
				if strings.Contains(err.Error(), "authPayload") {
					return normalized, encrypted, changed, nil
				}
			}
		}
		return normalizedPayload{}, encryptedField{}, nil, err
	}

	return normalized, encrypted, changed, nil
}

func validateNormalized(providerType, authMethod, serverURL, authPayload string, cacheTTLSeconds int) error {
	if strings.TrimSpace(providerType) == "" {
		return &requestError{status: http.StatusBadRequest, message: "providerType is required"}
	}
	if strings.TrimSpace(authMethod) == "" {
		return &requestError{status: http.StatusBadRequest, message: "authMethod is required"}
	}
	allowed, ok := allowedAuthMethods[providerType]
	if !ok {
		return &requestError{status: http.StatusBadRequest, message: "providerType is not supported"}
	}
	if _, ok := allowed[authMethod]; !ok {
		return &requestError{status: http.StatusBadRequest, message: "authMethod is not supported for the selected providerType"}
	}
	parsedURL, err := url.ParseRequestURI(serverURL)
	if err != nil || parsedURL.Scheme == "" || parsedURL.Host == "" {
		return &requestError{status: http.StatusBadRequest, message: "serverUrl must be a valid URL"}
	}
	if cacheTTLSeconds < 0 || cacheTTLSeconds > 86400 {
		return &requestError{status: http.StatusBadRequest, message: "cacheTtlSeconds must be between 0 and 86400"}
	}
	if err := validateAuthPayload(authMethod, authPayload); err != nil {
		return err
	}
	return nil
}

func validateAuthPayload(authMethod, raw string) error {
	if strings.TrimSpace(raw) == "" {
		return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
	}
	has := func(key string) bool {
		value, ok := parsed[key]
		if !ok {
			return false
		}
		text, ok := value.(string)
		return ok && strings.TrimSpace(text) != ""
	}
	switch authMethod {
	case "TOKEN":
		if !has("token") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "APPROLE":
		if !has("roleId") || !has("secretId") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "IAM_ACCESS_KEY":
		if !has("accessKeyId") || !has("secretAccessKey") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "CLIENT_CREDENTIALS":
		if !has("tenantId") || !has("clientId") || !has("clientSecret") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "SERVICE_ACCOUNT_KEY":
		if !has("serviceAccountKey") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "WORKLOAD_IDENTITY":
		if !has("projectId") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "CONJUR_API_KEY":
		if !has("login") || !has("apiKey") || !has("account") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	case "CONJUR_AUTHN_K8S":
		if !has("serviceId") || !has("account") {
			return &requestError{status: http.StatusBadRequest, message: "authPayload must be valid JSON with the expected keys for the selected authMethod"}
		}
	}
	return nil
}

func scanProvider(row interface{ Scan(...any) error }, dest *providerRecord) error {
	return row.Scan(
		&dest.ID,
		&dest.Name,
		&dest.ProviderType,
		&dest.ServerURL,
		&dest.AuthMethod,
		&dest.Namespace,
		&dest.MountPath,
		&dest.EncryptedAuthPayload,
		&dest.AuthPayloadIV,
		&dest.AuthPayloadTag,
		&dest.CACertificate,
		&dest.CacheTTLSeconds,
		&dest.Enabled,
		&dest.CreatedAt,
		&dest.UpdatedAt,
	)
}

func toProviderResponse(record providerRecord, includeCA bool) providerResponse {
	resp := providerResponse{
		ID:              record.ID,
		Name:            record.Name,
		ProviderType:    record.ProviderType,
		ServerURL:       record.ServerURL,
		AuthMethod:      record.AuthMethod,
		Namespace:       record.Namespace,
		MountPath:       record.MountPath,
		CacheTTLSeconds: record.CacheTTLSeconds,
		Enabled:         record.Enabled,
		CreatedAt:       record.CreatedAt,
		UpdatedAt:       record.UpdatedAt,
		HasAuthPayload:  strings.TrimSpace(record.EncryptedAuthPayload) != "",
	}
	if includeCA {
		resp.CACertificate = record.CACertificate
	}
	return resp
}

func requireTenantAdmin(claims authn.Claims) *requestError {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "Tenant membership required"}
	}
	switch strings.ToUpper(strings.TrimSpace(claims.TenantRole)) {
	case "OWNER", "ADMIN":
		return nil
	default:
		return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
	}
}

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID string, details map[string]any) error {
	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, $3::"AuditAction", 'ExternalVaultProvider', $4, $5)
`, uuid.NewString(), userID, action, targetID, details)
	return err
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

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func defaultOptional(value *string, fallback string) string {
	if value == nil || strings.TrimSpace(*value) == "" {
		return fallback
	}
	return strings.TrimSpace(*value)
}

func defaultInt(value *int, fallback int) int {
	if value == nil {
		return fallback
	}
	return *value
}

func normalizeOptional(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return &trimmed
}
