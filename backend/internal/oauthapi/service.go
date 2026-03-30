package oauthapi

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
	"os"
	"strings"
	"sync"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
	"golang.org/x/crypto/argon2"
)

type Service struct {
	DB        *pgxpool.Pool
	Redis     *redis.Client
	ServerKey []byte
	VaultTTL  time.Duration
}

type requestError struct {
	status  int
	message string
}

type linkedAccount struct {
	ID            string    `json:"id"`
	Provider      string    `json:"provider"`
	ProviderEmail *string   `json:"providerEmail"`
	CreatedAt     time.Time `json:"createdAt"`
}

type linkCodeEntry struct {
	UserID    string `json:"userId"`
	ExpiresAt int64  `json:"expiresAt"`
}

type authCodeEntry struct {
	AccessToken     string `json:"accessToken"`
	CSRFToken       string `json:"csrfToken"`
	NeedsVaultSetup bool   `json:"needsVaultSetup"`
	UserID          string `json:"userId"`
	Email           string `json:"email"`
	Username        string `json:"username"`
	AvatarData      string `json:"avatarData"`
	TenantID        string `json:"tenantId"`
	TenantRole      string `json:"tenantRole"`
	ExpiresAt       int64  `json:"expiresAt"`
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

var (
	linkCodeMu    sync.Mutex
	linkCodeStore = map[string]linkCodeEntry{}
	authCodeMu    sync.Mutex
	authCodeStore = map[string]authCodeEntry{}
)

const (
	linkCodeTTL = 60 * time.Second
	authCodeTTL = 60 * time.Second
)

func (e *requestError) Error() string {
	return e.message
}

func (s Service) HandleProviders(w http.ResponseWriter, _ *http.Request) {
	app.WriteJSON(w, http.StatusOK, availableProviders())
}

func (s Service) HandleGenerateLinkCode(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	code, err := s.GenerateLinkCode(r.Context(), claims.UserID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"code": code})
}

func (s Service) HandleExchangeCode(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Code string `json:"code"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.Code) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "Missing authorization code")
		return
	}

	entry, err := s.ConsumeAuthCode(r.Context(), payload.Code)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, entry)
}

func (s Service) HandleSetupVault(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload struct {
		VaultPassword string `json:"vaultPassword"`
	}
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}
	if strings.TrimSpace(payload.VaultPassword) == "" {
		app.ErrorJSON(w, http.StatusBadRequest, "vaultPassword is required")
		return
	}
	if err := validatePassword(payload.VaultPassword); err != nil {
		s.writeError(w, err)
		return
	}

	if err := s.SetupVaultForOAuthUser(r.Context(), claims.UserID, payload.VaultPassword); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true, "vaultSetupComplete": true})
}

func (s Service) HandleAccounts(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	items, err := s.ListAccounts(r.Context(), claims.UserID)
	if err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, items)
}

func (s Service) HandleUnlink(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.UnlinkAccount(r.Context(), claims.UserID, r.PathValue("provider")); err != nil {
		s.writeError(w, err)
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"success": true})
}

func (s Service) GenerateLinkCode(ctx context.Context, userID string) (string, error) {
	code, err := randomCode()
	if err != nil {
		return "", err
	}
	entry := linkCodeEntry{
		UserID:    userID,
		ExpiresAt: time.Now().Add(linkCodeTTL).UnixMilli(),
	}
	if s.Redis != nil {
		payload, err := json.Marshal(entry)
		if err != nil {
			return "", fmt.Errorf("marshal link code entry: %w", err)
		}
		if err := s.Redis.Set(ctx, "link:code:"+code, payload, linkCodeTTL).Err(); err != nil {
			return "", fmt.Errorf("store link code: %w", err)
		}
		return code, nil
	}

	linkCodeMu.Lock()
	defer linkCodeMu.Unlock()
	cleanupExpiredLinkCodesLocked(time.Now().UnixMilli())
	linkCodeStore[code] = entry
	return code, nil
}

func (s Service) ConsumeAuthCode(ctx context.Context, code string) (map[string]any, error) {
	entry, err := s.consumeAuthCodeEntry(ctx, strings.TrimSpace(code))
	if err != nil {
		return nil, err
	}
	return map[string]any{
		"accessToken":     entry.AccessToken,
		"csrfToken":       entry.CSRFToken,
		"needsVaultSetup": entry.NeedsVaultSetup,
		"userId":          entry.UserID,
		"email":           entry.Email,
		"username":        entry.Username,
		"avatarData":      entry.AvatarData,
		"tenantId":        entry.TenantID,
		"tenantRole":      entry.TenantRole,
	}, nil
}

func (s Service) SetupVaultForOAuthUser(ctx context.Context, userID, vaultPassword string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin oauth vault setup transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var vaultSetupComplete bool
	if err := tx.QueryRow(ctx, `SELECT COALESCE("vaultSetupComplete", false) FROM "User" WHERE id = $1`, userID).Scan(&vaultSetupComplete); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return fmt.Errorf("load oauth vault user: %w", err)
	}
	if vaultSetupComplete {
		return &requestError{status: http.StatusBadRequest, message: "Vault is already set up."}
	}

	vaultSalt := generateSalt()
	masterKey, err := generateMasterKey()
	if err != nil {
		return fmt.Errorf("generate master key: %w", err)
	}
	defer zeroBytes(masterKey)

	derivedKey := deriveKeyFromPassword(vaultPassword, vaultSalt)
	if len(derivedKey) == 0 {
		return fmt.Errorf("derive vault key: invalid salt")
	}
	defer zeroBytes(derivedKey)

	encryptedVault, err := encryptMasterKey(masterKey, derivedKey)
	if err != nil {
		return fmt.Errorf("encrypt master key: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`UPDATE "User"
		    SET "vaultSalt" = $2,
		        "encryptedVaultKey" = $3,
		        "vaultKeyIV" = $4,
		        "vaultKeyTag" = $5,
		        "vaultSetupComplete" = true
		  WHERE id = $1`,
		userID,
		vaultSalt,
		encryptedVault.Ciphertext,
		encryptedVault.IV,
		encryptedVault.Tag,
	); err != nil {
		return fmt.Errorf("update oauth vault setup: %w", err)
	}
	if err := insertAuditLog(ctx, tx, userID, "VAULT_SETUP", map[string]any{}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit oauth vault setup transaction: %w", err)
	}

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return err
	}
	return nil
}

func (s Service) ListAccounts(ctx context.Context, userID string) ([]linkedAccount, error) {
	if s.DB == nil {
		return nil, fmt.Errorf("database is unavailable")
	}

	rows, err := s.DB.Query(
		ctx,
		`SELECT id, provider::text, "providerEmail", "createdAt"
		   FROM "OAuthAccount"
		  WHERE "userId" = $1
		  ORDER BY "createdAt" ASC`,
		userID,
	)
	if err != nil {
		return nil, fmt.Errorf("list oauth accounts: %w", err)
	}
	defer rows.Close()

	items := make([]linkedAccount, 0)
	for rows.Next() {
		var item linkedAccount
		if err := rows.Scan(&item.ID, &item.Provider, &item.ProviderEmail, &item.CreatedAt); err != nil {
			return nil, fmt.Errorf("scan oauth account: %w", err)
		}
		items = append(items, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate oauth accounts: %w", err)
	}
	return items, nil
}

func (s Service) UnlinkAccount(ctx context.Context, userID, provider string) error {
	if s.DB == nil {
		return fmt.Errorf("database is unavailable")
	}
	normalized, err := normalizeProvider(provider)
	if err != nil {
		return err
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin oauth unlink transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var passwordHash *string
	if err := tx.QueryRow(ctx, `SELECT "passwordHash" FROM "User" WHERE id = $1`, userID).Scan(&passwordHash); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return fmt.Errorf("load unlink user: %w", err)
	}

	rows, err := tx.Query(ctx, `SELECT id, provider::text FROM "OAuthAccount" WHERE "userId" = $1`, userID)
	if err != nil {
		return fmt.Errorf("list unlink oauth accounts: %w", err)
	}
	defer rows.Close()

	var (
		targetID    string
		totalCount  int
		seenAccount bool
	)
	for rows.Next() {
		var accountID string
		var accountProvider string
		if err := rows.Scan(&accountID, &accountProvider); err != nil {
			return fmt.Errorf("scan unlink oauth account: %w", err)
		}
		totalCount++
		if accountProvider == normalized {
			targetID = accountID
			seenAccount = true
		}
	}
	if err := rows.Err(); err != nil {
		return fmt.Errorf("iterate unlink oauth accounts: %w", err)
	}
	if !seenAccount {
		return &requestError{status: http.StatusNotFound, message: "OAuth account not found"}
	}
	if strings.TrimSpace(deref(passwordHash)) == "" && totalCount <= 1 {
		return &requestError{
			status:  http.StatusBadRequest,
			message: "Cannot unlink your only sign-in method. Set a password first or link another OAuth provider.",
		}
	}

	if _, err := tx.Exec(ctx, `DELETE FROM "OAuthAccount" WHERE id = $1`, targetID); err != nil {
		return fmt.Errorf("delete oauth account: %w", err)
	}
	if err := insertAuditLog(ctx, tx, userID, "OAUTH_UNLINK", map[string]any{"provider": strings.ToLower(normalized)}); err != nil {
		return err
	}
	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit oauth unlink transaction: %w", err)
	}
	return nil
}

func (s Service) consumeAuthCodeEntry(ctx context.Context, code string) (authCodeEntry, error) {
	if code == "" {
		return authCodeEntry{}, &requestError{status: http.StatusBadRequest, message: "Missing authorization code"}
	}

	if s.Redis != nil {
		payload, err := s.Redis.GetDel(ctx, "auth:code:"+code).Bytes()
		if err == nil {
			var entry authCodeEntry
			if err := json.Unmarshal(payload, &entry); err != nil {
				return authCodeEntry{}, fmt.Errorf("decode auth code payload: %w", err)
			}
			if entry.ExpiresAt <= time.Now().UnixMilli() {
				return authCodeEntry{}, &requestError{status: http.StatusBadRequest, message: "Invalid or expired authorization code"}
			}
			return entry, nil
		}
		if !errors.Is(err, redis.Nil) {
			return authCodeEntry{}, fmt.Errorf("load auth code: %w", err)
		}
	}

	authCodeMu.Lock()
	defer authCodeMu.Unlock()
	cleanupExpiredAuthCodesLocked(time.Now().UnixMilli())
	entry, ok := authCodeStore[code]
	if !ok {
		return authCodeEntry{}, &requestError{status: http.StatusBadRequest, message: "Invalid or expired authorization code"}
	}
	delete(authCodeStore, code)
	if entry.ExpiresAt <= time.Now().UnixMilli() {
		return authCodeEntry{}, &requestError{status: http.StatusBadRequest, message: "Invalid or expired authorization code"}
	}
	return entry, nil
}

func availableProviders() map[string]bool {
	providers := map[string]bool{}
	if strings.TrimSpace(os.Getenv("GOOGLE_CLIENT_ID")) != "" {
		providers["google"] = true
	}
	if strings.TrimSpace(os.Getenv("MICROSOFT_CLIENT_ID")) != "" {
		providers["microsoft"] = true
	}
	if strings.TrimSpace(os.Getenv("GITHUB_CLIENT_ID")) != "" {
		providers["github"] = true
	}
	if strings.TrimSpace(os.Getenv("OIDC_CLIENT_ID")) != "" {
		providers["oidc"] = true
	}
	if strings.TrimSpace(os.Getenv("SAML_ENTRY_POINT")) != "" {
		providers["saml"] = true
	}
	if strings.EqualFold(strings.TrimSpace(os.Getenv("LDAP_ENABLED")), "true") && strings.TrimSpace(os.Getenv("LDAP_SERVER_URL")) != "" {
		providers["ldap"] = true
	}
	return providers
}

func normalizeProvider(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "GOOGLE", "MICROSOFT", "GITHUB", "OIDC", "SAML", "LDAP":
		return strings.ToUpper(strings.TrimSpace(value)), nil
	default:
		return "", &requestError{status: http.StatusBadRequest, message: "OAuth provider not available"}
	}
}

func randomCode() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("generate random code: %w", err)
	}
	return fmt.Sprintf("%x", buf), nil
}

func cleanupExpiredLinkCodesLocked(now int64) {
	for code, entry := range linkCodeStore {
		if entry.ExpiresAt <= now {
			delete(linkCodeStore, code)
		}
	}
}

func cleanupExpiredAuthCodesLocked(now int64) {
	for code, entry := range authCodeStore {
		if entry.ExpiresAt <= now {
			delete(authCodeStore, code)
		}
	}
}

func validatePassword(password string) error {
	switch {
	case len(password) < 10:
		return &requestError{status: http.StatusBadRequest, message: "Password must be at least 10 characters"}
	case !strings.ContainsAny(password, "abcdefghijklmnopqrstuvwxyz"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain a lowercase letter"}
	case !strings.ContainsAny(password, "ABCDEFGHIJKLMNOPQRSTUVWXYZ"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain an uppercase letter"}
	case !strings.ContainsAny(password, "0123456789"):
		return &requestError{status: http.StatusBadRequest, message: "Password must contain a digit"}
	default:
		return nil
	}
}

func generateSalt() string {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate salt: %w", err))
	}
	return hex.EncodeToString(buf)
}

func generateMasterKey() ([]byte, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return nil, err
	}
	return buf, nil
}

func deriveKeyFromPassword(password, saltHex string) []byte {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil
	}
	return argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
}

func encryptMasterKey(masterKey, derivedKey []byte) (encryptedField, error) {
	if len(derivedKey) != 32 {
		return encryptedField{}, fmt.Errorf("derived key must be 32 bytes")
	}

	block, err := aes.NewCipher(derivedKey)
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

	ciphertextWithTag := aead.Seal(nil, iv, []byte(hex.EncodeToString(masterKey)), nil)
	tagSize := aead.Overhead()
	if len(ciphertextWithTag) < tagSize {
		return encryptedField{}, fmt.Errorf("encrypted payload too short")
	}
	return encryptedField{
		Ciphertext: hex.EncodeToString(ciphertextWithTag[:len(ciphertextWithTag)-tagSize]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(ciphertextWithTag[len(ciphertextWithTag)-tagSize:]),
	}, nil
}

func encryptValue(key []byte, plaintext string) (encryptedField, error) {
	if len(key) != 32 {
		return encryptedField{}, fmt.Errorf("invalid key length")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedField{}, fmt.Errorf("generate iv: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	sealed := aead.Seal(nil, iv, []byte(plaintext), nil)
	tagOffset := len(sealed) - aead.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:tagOffset]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(sealed[tagOffset:]),
	}, nil
}

func (s Service) storeVaultSession(ctx context.Context, userID string, masterKey []byte) error {
	if s.Redis == nil || len(s.ServerKey) == 0 {
		return nil
	}
	encrypted, err := encryptValue(s.ServerKey, hex.EncodeToString(masterKey))
	if err != nil {
		return fmt.Errorf("encrypt vault session: %w", err)
	}
	raw, err := json.Marshal(encrypted)
	if err != nil {
		return fmt.Errorf("marshal vault session: %w", err)
	}
	ttl := s.VaultTTL
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if err := s.Redis.Set(ctx, "vault:user:"+userID, raw, ttl).Err(); err != nil {
		return fmt.Errorf("store vault session: %w", err)
	}
	recoveryTTL := 7 * 24 * time.Hour
	if err := s.Redis.Set(ctx, "vault:recovery:"+userID, raw, recoveryTTL).Err(); err != nil {
		return fmt.Errorf("store vault recovery: %w", err)
	}
	return nil
}

func zeroBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

func insertAuditLog(ctx context.Context, tx pgx.Tx, userID, action string, details map[string]any) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			id, "userId", action, details, "createdAt"
		) VALUES (
			$1, $2, $3::"AuditAction", $4::jsonb, $5
		)`,
		uuid.NewString(),
		userID,
		action,
		string(rawDetails),
		time.Now(),
	); err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func deref(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func (s Service) writeError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		app.ErrorJSON(w, reqErr.status, reqErr.message)
		return
	}
	app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
}
