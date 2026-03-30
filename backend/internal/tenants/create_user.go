package tenants

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/bcrypt"
)

type createUserPayload struct {
	Email            string  `json:"email"`
	Username         *string `json:"username"`
	Password         string  `json:"password"`
	Role             string  `json:"role"`
	SendWelcomeEmail bool    `json:"sendWelcomeEmail"`
	ExpiresAt        *string `json:"expiresAt"`
}

type createdManagedUser struct {
	ID        string     `json:"id"`
	Email     string     `json:"email"`
	Username  *string    `json:"username"`
	CreatedAt time.Time  `json:"createdAt"`
	Role      string     `json:"role"`
	ExpiresAt *time.Time `json:"expiresAt,omitempty"`
}

type createdManagedUserResponse struct {
	User        createdManagedUser `json:"user"`
	RecoveryKey string             `json:"recoveryKey"`
}

type encryptedTenantField struct {
	Ciphertext string
	IV         string
	Tag        string
}

const managedUserBcryptRounds = 12

func (s Service) HandleCreateUser(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireOwnTenant(claims, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.requireManageUsersPermission(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload createUserPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.CreateUser(r.Context(), claims.TenantID, payload)
	if err != nil {
		var reqErr *requestError
		if errorsAsRequestError(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) CreateUser(ctx context.Context, tenantID string, payload createUserPayload) (createdManagedUserResponse, error) {
	if s.DB == nil {
		return createdManagedUserResponse{}, fmt.Errorf("database is unavailable")
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if !looksLikeEmail(email) {
		return createdManagedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "email must be a valid email"}
	}
	if err := validateManagedUserPassword(payload.Password); err != nil {
		return createdManagedUserResponse{}, err
	}

	role := strings.ToUpper(strings.TrimSpace(payload.Role))
	switch role {
	case "ADMIN", "OPERATOR", "MEMBER", "CONSULTANT", "AUDITOR", "GUEST":
	default:
		return createdManagedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "role must be one of ADMIN, OPERATOR, MEMBER, CONSULTANT, AUDITOR, GUEST"}
	}

	var username *string
	if payload.Username != nil {
		value := strings.TrimSpace(*payload.Username)
		if value == "" || len(value) > 100 {
			return createdManagedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "username must be between 1 and 100 characters"}
		}
		username = &value
	}

	var expiresAt *time.Time
	if payload.ExpiresAt != nil && strings.TrimSpace(*payload.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*payload.ExpiresAt))
		if err != nil {
			return createdManagedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "expiresAt must be a valid ISO-8601 date-time"}
		}
		expiresAt = &parsed
	}

	var existingUserID string
	err := s.DB.QueryRow(ctx, `SELECT id FROM "User" WHERE email = $1`, email).Scan(&existingUserID)
	switch {
	case err == nil:
		var existingMembershipID string
		memErr := s.DB.QueryRow(ctx, `SELECT id FROM "TenantMember" WHERE "tenantId" = $1 AND "userId" = $2`, tenantID, existingUserID).Scan(&existingMembershipID)
		if memErr == nil {
			return createdManagedUserResponse{}, &requestError{status: http.StatusBadRequest, message: "User is already a member of this organization"}
		}
		if memErr != nil && memErr != pgx.ErrNoRows {
			return createdManagedUserResponse{}, fmt.Errorf("load existing membership: %w", memErr)
		}
		return createdManagedUserResponse{}, &requestError{status: http.StatusConflict, message: "A user with this email already exists"}
	case err != nil && err != pgx.ErrNoRows:
		return createdManagedUserResponse{}, fmt.Errorf("check existing user: %w", err)
	}

	passwordHash, err := bcrypt.GenerateFromPassword([]byte(payload.Password), managedUserBcryptRounds)
	if err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("hash password: %w", err)
	}

	vaultSalt := generateTenantSalt()
	masterKey := generateTenantMasterKey()
	defer zeroTenantBytes(masterKey)

	derivedKey := deriveTenantKeyFromPassword(payload.Password, vaultSalt)
	if len(derivedKey) == 0 {
		return createdManagedUserResponse{}, fmt.Errorf("derive vault key: invalid salt")
	}
	defer zeroTenantBytes(derivedKey)

	encryptedVault, err := encryptTenantMasterKey(masterKey, derivedKey)
	if err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("encrypt vault key: %w", err)
	}

	recoveryKey, err := generateTenantRecoveryKey()
	if err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("generate recovery key: %w", err)
	}
	recoverySalt := generateTenantSalt()
	recoveryDerived := deriveTenantKeyFromPassword(recoveryKey, recoverySalt)
	if len(recoveryDerived) == 0 {
		return createdManagedUserResponse{}, fmt.Errorf("derive recovery key: invalid salt")
	}
	defer zeroTenantBytes(recoveryDerived)

	encryptedRecovery, err := encryptTenantMasterKey(masterKey, recoveryDerived)
	if err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("encrypt recovery key: %w", err)
	}

	tx, err := s.DB.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("begin create managed user: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	userID := uuid.NewString()
	membershipID := uuid.NewString()

	var created createdManagedUser
	if err := tx.QueryRow(
		ctx,
		`INSERT INTO "User" (
			id, email, username, enabled, "emailVerified", "passwordHash",
			"vaultSalt", "encryptedVaultKey", "vaultKeyIV", "vaultKeyTag",
			"encryptedVaultRecoveryKey", "vaultRecoveryKeyIV", "vaultRecoveryKeyTag", "vaultRecoveryKeySalt",
			"vaultSetupComplete", "createdAt", "updatedAt"
		) VALUES (
			$1, $2, $3, true, true, $4,
			$5, $6, $7, $8,
			$9, $10, $11, $12,
			true, NOW(), NOW()
		)
		RETURNING id, email, username, "createdAt"`,
		userID,
		email,
		username,
		string(passwordHash),
		vaultSalt,
		encryptedVault.Ciphertext,
		encryptedVault.IV,
		encryptedVault.Tag,
		encryptedRecovery.Ciphertext,
		encryptedRecovery.IV,
		encryptedRecovery.Tag,
		recoverySalt,
	).Scan(&created.ID, &created.Email, &created.Username, &created.CreatedAt); err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("insert managed user: %w", err)
	}

	if _, err := tx.Exec(
		ctx,
		`INSERT INTO "TenantMember" (
			id, "tenantId", "userId", role, status, "isActive", "joinedAt", "expiresAt", "updatedAt"
		) VALUES (
			$1, $2, $3, $4::"TenantRole", 'ACCEPTED', false, NOW(), $5, NOW()
		)`,
		membershipID,
		tenantID,
		userID,
		role,
		expiresAt,
	); err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("insert tenant membership: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return createdManagedUserResponse{}, fmt.Errorf("commit managed user creation: %w", err)
	}

	created.Role = role
	created.ExpiresAt = expiresAt
	return createdManagedUserResponse{
		User:        created,
		RecoveryKey: recoveryKey,
	}, nil
}

func errorsAsRequestError(err error, target **requestError) bool {
	if err == nil {
		return false
	}
	reqErr, ok := err.(*requestError)
	if !ok {
		return false
	}
	*target = reqErr
	return true
}

func looksLikeEmail(value string) bool {
	at := strings.Index(value, "@")
	dot := strings.LastIndex(value, ".")
	return at > 0 && dot > at+1 && dot < len(value)-1
}

func validateManagedUserPassword(password string) error {
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

func generateTenantSalt() string {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate salt: %w", err))
	}
	return hex.EncodeToString(buf)
}

func generateTenantMasterKey() []byte {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate master key: %w", err))
	}
	return buf
}

func generateTenantRecoveryKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func deriveTenantKeyFromPassword(password, saltHex string) []byte {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil
	}
	return argon2.IDKey([]byte(password), salt, 3, 65536, 1, 32)
}

func encryptTenantMasterKey(masterKey, derivedKey []byte) (encryptedTenantField, error) {
	if len(derivedKey) != 32 {
		return encryptedTenantField{}, fmt.Errorf("derived key must be 32 bytes")
	}
	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return encryptedTenantField{}, fmt.Errorf("create cipher: %w", err)
	}
	aead, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedTenantField{}, fmt.Errorf("create gcm: %w", err)
	}
	iv := make([]byte, 16)
	if _, err := io.ReadFull(rand.Reader, iv); err != nil {
		return encryptedTenantField{}, fmt.Errorf("generate iv: %w", err)
	}
	sealed := aead.Seal(nil, iv, []byte(hex.EncodeToString(masterKey)), nil)
	tagOffset := len(sealed) - aead.Overhead()
	return encryptedTenantField{
		Ciphertext: hex.EncodeToString(sealed[:tagOffset]),
		IV:         hex.EncodeToString(iv),
		Tag:        hex.EncodeToString(sealed[tagOffset:]),
	}, nil
}

func zeroTenantBytes(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}
