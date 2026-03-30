package setup

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"
)

type setupCompletePayload struct {
	Admin struct {
		Email    string  `json:"email"`
		Username *string `json:"username"`
		Password string  `json:"password"`
	} `json:"admin"`
	Tenant struct {
		Name string `json:"name"`
	} `json:"tenant"`
	Settings *struct {
		SelfSignupEnabled *bool `json:"selfSignupEnabled"`
		SMTP              *struct {
			Host   string  `json:"host"`
			Port   int     `json:"port"`
			User   *string `json:"user"`
			Pass   *string `json:"pass"`
			From   *string `json:"from"`
			Secure *bool   `json:"secure"`
		} `json:"smtp"`
	} `json:"settings"`
}

type setupCompleteResponse struct {
	RecoveryKey       string                 `json:"recoveryKey"`
	AccessToken       string                 `json:"accessToken"`
	CSRFToken         string                 `json:"csrfToken"`
	User              map[string]any         `json:"user"`
	Tenant            any                    `json:"tenant"`
	TenantMemberships []map[string]any       `json:"tenantMemberships,omitempty"`
	SystemSecrets     []systemSecretResponse `json:"systemSecrets,omitempty"`
}

type completedSetupResult struct {
	response       setupCompleteResponse
	refreshToken   string
	refreshExpires time.Duration
}

func (s Service) HandleComplete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		app.ErrorJSON(w, http.StatusMethodNotAllowed, "method not allowed")
		return
	}

	result, err := s.CompleteSetup(r.Context(), r)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	csrfToken := s.AuthService.ApplyRefreshCookies(w, result.refreshToken, result.refreshExpires)
	result.response.CSRFToken = csrfToken
	app.WriteJSON(w, http.StatusCreated, result.response)
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func (s Service) CompleteSetup(ctx context.Context, r *http.Request) (completedSetupResult, error) {
	if s.DB == nil {
		return completedSetupResult{}, fmt.Errorf("database is unavailable")
	}
	if s.AuthService == nil || s.TenantService == nil {
		return completedSetupResult{}, fmt.Errorf("setup dependencies are unavailable")
	}

	required, err := s.isSetupRequired(ctx)
	if err != nil {
		return completedSetupResult{}, err
	}
	if !required {
		return completedSetupResult{}, &requestError{status: http.StatusConflict, message: "Setup has already been completed"}
	}

	var payload setupCompletePayload
	if err := app.ReadJSON(r, &payload); err != nil {
		return completedSetupResult{}, &requestError{status: http.StatusBadRequest, message: err.Error()}
	}
	if err := validateSetupPayload(payload); err != nil {
		return completedSetupResult{}, err
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(payload.Admin.Password), 12)
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("hash password: %w", err)
	}

	vaultSalt, err := generateSalt()
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("generate vault salt: %w", err)
	}
	masterKey, err := generateMasterKey()
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("generate master key: %w", err)
	}
	defer zeroBytes(masterKey)

	derivedKey, err := deriveKeyFromPassword(payload.Admin.Password, vaultSalt)
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("derive vault key: %w", err)
	}
	defer zeroBytes(derivedKey)

	encryptedVaultKey, err := encryptMasterKey(masterKey, derivedKey)
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("encrypt vault key: %w", err)
	}

	recoveryKey, err := generateRecoveryKey()
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("generate recovery key: %w", err)
	}
	recoverySalt, err := generateSalt()
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("generate recovery salt: %w", err)
	}
	recoveryDerived, err := deriveKeyFromPassword(recoveryKey, recoverySalt)
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("derive recovery key: %w", err)
	}
	defer zeroBytes(recoveryDerived)

	encryptedRecoveryKey, err := encryptMasterKey(masterKey, recoveryDerived)
	if err != nil {
		return completedSetupResult{}, fmt.Errorf("encrypt recovery key: %w", err)
	}

	userID, err := s.createSetupAdmin(ctx, payload, string(passwordHash), vaultSalt, encryptedVaultKey, recoverySalt, encryptedRecoveryKey)
	if err != nil {
		return completedSetupResult{}, err
	}

	if err := s.storeVaultSession(ctx, userID, masterKey); err != nil {
		return completedSetupResult{}, err
	}

	createdTenant, err := s.TenantService.CreateTenant(ctx, userID, payload.Tenant.Name, requestIP(r))
	if err != nil {
		return completedSetupResult{}, err
	}

	browserTokens, err := s.AuthService.IssueBrowserTokensForUser(ctx, userID, requestIP(r), r.UserAgent())
	if err != nil {
		return completedSetupResult{}, err
	}

	memberships, err := s.listTenantMemberships(ctx, userID)
	if err != nil {
		return completedSetupResult{}, err
	}
	systemSecrets, err := s.listSystemSecretsForDisplay(ctx)
	if err != nil {
		return completedSetupResult{}, err
	}

	return completedSetupResult{
		response: setupCompleteResponse{
			RecoveryKey: recoveryKey,
			AccessToken: browserTokens.AccessToken,
			User: map[string]any{
				"id":       browserTokens.User.ID,
				"email":    browserTokens.User.Email,
				"username": browserTokens.User.Username,
			},
			Tenant:            createdTenant,
			TenantMemberships: memberships,
			SystemSecrets:     systemSecrets,
		},
		refreshToken:   browserTokens.RefreshToken,
		refreshExpires: browserTokens.RefreshExpires,
	}, nil
}

func validateSetupPayload(payload setupCompletePayload) error {
	payload.Admin.Email = strings.TrimSpace(strings.ToLower(payload.Admin.Email))
	payload.Admin.Password = strings.TrimSpace(payload.Admin.Password)
	payload.Tenant.Name = strings.TrimSpace(payload.Tenant.Name)

	if _, err := mail.ParseAddress(payload.Admin.Email); err != nil {
		return &requestError{status: http.StatusBadRequest, message: "admin.email must be a valid email"}
	}
	if len(payload.Admin.Password) < 8 {
		return &requestError{status: http.StatusBadRequest, message: "admin.password must be at least 8 characters"}
	}
	if payload.Admin.Username != nil {
		username := strings.TrimSpace(*payload.Admin.Username)
		if len(username) < 2 || len(username) > 50 {
			return &requestError{status: http.StatusBadRequest, message: "admin.username must be between 2 and 50 characters"}
		}
	}
	if len(payload.Tenant.Name) < 1 || len(payload.Tenant.Name) > 100 {
		return &requestError{status: http.StatusBadRequest, message: "tenant.name must be between 1 and 100 characters"}
	}
	if payload.Settings != nil && payload.Settings.SMTP != nil {
		smtp := payload.Settings.SMTP
		if strings.TrimSpace(smtp.Host) == "" || smtp.Port < 1 || smtp.Port > 65535 {
			return &requestError{status: http.StatusBadRequest, message: "settings.smtp.host and settings.smtp.port are required"}
		}
	}
	return nil
}

func (s Service) createSetupAdmin(
	ctx context.Context,
	payload setupCompletePayload,
	passwordHash string,
	vaultSalt string,
	encryptedVaultKey encryptedField,
	recoverySalt string,
	encryptedRecoveryKey encryptedField,
) (string, error) {
	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return "", fmt.Errorf("begin setup transaction: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	userID := uuid.NewString()
	if _, err := tx.Exec(ctx, `
INSERT INTO "User" (
	id, email, username, "passwordHash", "vaultSalt", "encryptedVaultKey", "vaultKeyIV", "vaultKeyTag",
	"encryptedVaultRecoveryKey", "vaultRecoveryKeyIV", "vaultRecoveryKeyTag", "vaultRecoveryKeySalt",
	"emailVerified", "vaultSetupComplete", enabled, "createdAt", "updatedAt"
) VALUES (
	$1, $2, $3, $4, $5, $6, $7, $8,
	$9, $10, $11, $12,
	true, true, true, NOW(), NOW()
)`,
		userID,
		strings.TrimSpace(strings.ToLower(payload.Admin.Email)),
		normalizeOptionalString(payload.Admin.Username),
		passwordHash,
		vaultSalt,
		encryptedVaultKey.Ciphertext,
		encryptedVaultKey.IV,
		encryptedVaultKey.Tag,
		encryptedRecoveryKey.Ciphertext,
		encryptedRecoveryKey.IV,
		encryptedRecoveryKey.Tag,
		recoverySalt,
	); err != nil {
		return "", fmt.Errorf("create setup admin: %w", err)
	}

	if payload.Settings != nil {
		if payload.Settings.SelfSignupEnabled != nil {
			if err := upsertAppConfig(ctx, tx, "selfSignupEnabled", fmt.Sprintf("%t", *payload.Settings.SelfSignupEnabled)); err != nil {
				return "", err
			}
		}
		if payload.Settings.SMTP != nil {
			smtp := payload.Settings.SMTP
			pairs := [][2]string{
				{"smtpHost", strings.TrimSpace(smtp.Host)},
				{"smtpPort", fmt.Sprintf("%d", smtp.Port)},
			}
			if smtp.User != nil {
				pairs = append(pairs, [2]string{"smtpUser", strings.TrimSpace(*smtp.User)})
			}
			if smtp.Pass != nil {
				pairs = append(pairs, [2]string{"smtpPass", *smtp.Pass})
			}
			if smtp.From != nil {
				pairs = append(pairs, [2]string{"smtpFrom", strings.TrimSpace(*smtp.From)})
			}
			if smtp.Secure != nil {
				pairs = append(pairs, [2]string{"smtpSecure", fmt.Sprintf("%t", *smtp.Secure)})
			}
			for _, pair := range pairs {
				if err := upsertAppConfig(ctx, tx, pair[0], pair[1]); err != nil {
					return "", err
				}
			}
		}
	}

	if err := upsertAppConfig(ctx, tx, "setupCompleted", "true"); err != nil {
		return "", err
	}
	if err := insertAuditLogTx(ctx, tx, userID, "REGISTER", map[string]any{"via": "setup-wizard"}); err != nil {
		return "", err
	}

	if err := tx.Commit(ctx); err != nil {
		return "", fmt.Errorf("commit setup transaction: %w", err)
	}
	return userID, nil
}

func upsertAppConfig(ctx context.Context, tx pgx.Tx, key, value string) error {
	_, err := tx.Exec(ctx, `
INSERT INTO "AppConfig" (key, value, "updatedAt")
VALUES ($1, $2, NOW())
ON CONFLICT (key)
DO UPDATE SET value = EXCLUDED.value, "updatedAt" = NOW()
`, key, value)
	if err != nil {
		return fmt.Errorf("upsert app config %s: %w", key, err)
	}
	return nil
}

func insertAuditLogTx(ctx context.Context, tx pgx.Tx, userID, action string, details map[string]any) error {
	rawDetails, err := json.Marshal(details)
	if err != nil {
		return fmt.Errorf("marshal audit details: %w", err)
	}
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, details, "createdAt")
VALUES ($1, $2, $3::"AuditAction", $4::jsonb, NOW())
`, uuid.NewString(), userID, action, string(rawDetails)); err != nil {
		return fmt.Errorf("insert setup audit log: %w", err)
	}
	return nil
}

func (s Service) storeVaultSession(ctx context.Context, userID string, masterKey []byte) error {
	if s.Redis == nil || len(s.ServerKey) != 32 {
		return nil
	}
	encrypted, err := encryptValue(s.ServerKey, fmt.Sprintf("%x", masterKey))
	if err != nil {
		return fmt.Errorf("encrypt setup vault session: %w", err)
	}
	raw, err := json.Marshal(encrypted)
	if err != nil {
		return fmt.Errorf("marshal setup vault session: %w", err)
	}
	ttl := s.VaultTTL
	if ttl <= 0 {
		ttl = 30 * time.Minute
	}
	if err := s.Redis.Set(ctx, "vault:user:"+userID, raw, ttl).Err(); err != nil {
		return fmt.Errorf("store setup vault session: %w", err)
	}
	if err := s.Redis.Set(ctx, "vault:recovery:"+userID, raw, 7*24*time.Hour).Err(); err != nil {
		return fmt.Errorf("store setup vault recovery: %w", err)
	}
	return nil
}

func (s Service) listTenantMemberships(ctx context.Context, userID string) ([]map[string]any, error) {
	rows, err := s.DB.Query(ctx, `
SELECT tm."tenantId", t.name, t.slug, tm.role::text, tm.status::text, tm."isActive"
  FROM "TenantMember" tm
  JOIN "Tenant" t ON t.id = tm."tenantId"
 WHERE tm."userId" = $1
   AND (tm."expiresAt" IS NULL OR tm."expiresAt" > NOW())
 ORDER BY tm."joinedAt" ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("query setup memberships: %w", err)
	}
	defer rows.Close()

	result := make([]map[string]any, 0)
	for rows.Next() {
		var tenantID, name, slug, role, status string
		var isActive bool
		if err := rows.Scan(&tenantID, &name, &slug, &role, &status, &isActive); err != nil {
			return nil, fmt.Errorf("scan setup membership: %w", err)
		}
		result = append(result, map[string]any{
			"tenantId": tenantID,
			"name":     name,
			"slug":     slug,
			"role":     role,
			"status":   status,
			"pending":  status != "ACCEPTED",
			"isActive": isActive,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate setup memberships: %w", err)
	}
	return result, nil
}

func normalizeOptionalString(value *string) any {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return trimmed
}
