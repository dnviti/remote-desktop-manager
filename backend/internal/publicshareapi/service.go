package publicshareapi

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/argon2"
	"golang.org/x/crypto/hkdf"
)

var pinPattern = regexp.MustCompile(`^\d{4,8}$`)

type Service struct {
	DB *pgxpool.Pool
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type shareInfoResponse struct {
	ID          string `json:"id"`
	SecretName  string `json:"secretName"`
	SecretType  string `json:"secretType"`
	HasPin      bool   `json:"hasPin"`
	ExpiresAt   string `json:"expiresAt"`
	IsExpired   bool   `json:"isExpired"`
	IsExhausted bool   `json:"isExhausted"`
	IsRevoked   bool   `json:"isRevoked"`
}

type shareAccessResponse struct {
	SecretName string         `json:"secretName"`
	SecretType string         `json:"secretType"`
	Data       map[string]any `json:"data"`
}

type shareRecord struct {
	ID             string
	SecretID       string
	SecretName     string
	SecretType     string
	EncryptedData  string
	DataIV         string
	DataTag        string
	HasPin         bool
	PinSalt        sql.NullString
	TokenSalt      sql.NullString
	ExpiresAt      time.Time
	MaxAccessCount sql.NullInt32
	AccessCount    int
	IsRevoked      bool
}

func (s Service) HandleGetInfo(w http.ResponseWriter, r *http.Request) {
	info, err := s.GetInfo(r.Context(), strings.TrimSpace(r.PathValue("token")))
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, info)
}

func (s Service) HandleAccess(w http.ResponseWriter, r *http.Request) {
	var payload struct {
		Pin string `json:"pin"`
	}
	if r.Body != nil && r.ContentLength != 0 {
		if err := app.ReadJSON(r, &payload); err != nil && !errors.Is(err, io.EOF) {
			app.ErrorJSON(w, http.StatusBadRequest, err.Error())
			return
		}
	}
	payload.Pin = strings.TrimSpace(payload.Pin)
	if payload.Pin != "" && !pinPattern.MatchString(payload.Pin) {
		app.ErrorJSON(w, http.StatusBadRequest, "PIN must be 4-8 digits")
		return
	}

	result, err := s.Access(r.Context(), strings.TrimSpace(r.PathValue("token")), payload.Pin, clientIP(r))
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

func (s Service) GetInfo(ctx context.Context, token string) (shareInfoResponse, error) {
	share, err := s.loadShareByToken(ctx, token)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return fakeInfo(), nil
		}
		return shareInfoResponse{}, err
	}

	now := time.Now()
	return shareInfoResponse{
		ID:          share.ID,
		SecretName:  share.SecretName,
		SecretType:  share.SecretType,
		HasPin:      share.HasPin,
		ExpiresAt:   share.ExpiresAt.UTC().Format(time.RFC3339),
		IsExpired:   share.ExpiresAt.Before(now),
		IsExhausted: share.MaxAccessCount.Valid && share.AccessCount >= int(share.MaxAccessCount.Int32),
		IsRevoked:   share.IsRevoked,
	}, nil
}

func (s Service) Access(ctx context.Context, token, pin, ipAddress string) (shareAccessResponse, error) {
	share, err := s.loadShareByToken(ctx, token)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return shareAccessResponse{}, &requestError{status: http.StatusGone, message: "Share is no longer available"}
		}
		return shareAccessResponse{}, err
	}

	if share.IsRevoked || share.ExpiresAt.Before(time.Now()) || (share.MaxAccessCount.Valid && share.AccessCount >= int(share.MaxAccessCount.Int32)) {
		return shareAccessResponse{}, &requestError{status: http.StatusGone, message: "Share is no longer available"}
	}
	if share.HasPin && pin == "" {
		return shareAccessResponse{}, &requestError{status: http.StatusBadRequest, message: "PIN is required"}
	}

	var key []byte
	if share.HasPin {
		if !share.PinSalt.Valid {
			return shareAccessResponse{}, fmt.Errorf("share %s missing pin salt", share.ID)
		}
		key, err = deriveKeyFromTokenAndPin(token, pin, share.PinSalt.String)
	} else {
		key, err = deriveKeyFromToken(token, share.ID, share.TokenSalt.String)
	}
	if err != nil {
		return shareAccessResponse{}, fmt.Errorf("derive share key: %w", err)
	}
	defer zero(key)

	plaintext, err := decryptPayload(share.EncryptedData, share.DataIV, share.DataTag, key)
	if err != nil {
		return shareAccessResponse{}, &requestError{status: http.StatusForbidden, message: "Invalid PIN or corrupted data"}
	}

	var data map[string]any
	if err := json.Unmarshal([]byte(plaintext), &data); err != nil {
		return shareAccessResponse{}, fmt.Errorf("decode share payload: %w", err)
	}

	if _, err := s.DB.Exec(ctx, `UPDATE "ExternalSecretShare" SET "accessCount" = "accessCount" + 1 WHERE id = $1`, share.ID); err != nil {
		return shareAccessResponse{}, fmt.Errorf("increment share access count: %w", err)
	}
	if err := s.insertAuditLog(ctx, nil, "SECRET_EXTERNAL_ACCESS", "ExternalSecretShare", share.ID, map[string]any{
		"secretId":   share.SecretID,
		"secretName": share.SecretName,
	}, ipAddress); err != nil {
		return shareAccessResponse{}, fmt.Errorf("insert access audit log: %w", err)
	}

	return shareAccessResponse{
		SecretName: share.SecretName,
		SecretType: share.SecretType,
		Data:       data,
	}, nil
}

func (s Service) loadShareByToken(ctx context.Context, token string) (shareRecord, error) {
	tokenHash := hashToken(token)
	row := s.DB.QueryRow(ctx, `
SELECT
	id,
	"secretId",
	"secretName",
	"secretType"::text,
	"encryptedData",
	"dataIV",
	"dataTag",
	"hasPin",
	"pinSalt",
	"tokenSalt",
	"expiresAt",
	"maxAccessCount",
	"accessCount",
	"isRevoked"
FROM "ExternalSecretShare"
WHERE "tokenHash" = $1
`, tokenHash)

	var share shareRecord
	if err := row.Scan(
		&share.ID,
		&share.SecretID,
		&share.SecretName,
		&share.SecretType,
		&share.EncryptedData,
		&share.DataIV,
		&share.DataTag,
		&share.HasPin,
		&share.PinSalt,
		&share.TokenSalt,
		&share.ExpiresAt,
		&share.MaxAccessCount,
		&share.AccessCount,
		&share.IsRevoked,
	); err != nil {
		if strings.Contains(err.Error(), "no rows") {
			return shareRecord{}, sql.ErrNoRows
		}
		return shareRecord{}, fmt.Errorf("load external share: %w", err)
	}
	return share, nil
}

func (s Service) insertAuditLog(ctx context.Context, userID *string, action, targetType, targetID string, details map[string]any, ipAddress string) error {
	var rawDetails []byte
	if details != nil {
		encoded, err := json.Marshal(details)
		if err != nil {
			return fmt.Errorf("marshal audit details: %w", err)
		}
		rawDetails = encoded
	}

	_, err := s.DB.Exec(ctx, `
INSERT INTO "AuditLog" (
	id,
	"userId",
	action,
	"targetType",
	"targetId",
	details,
	"ipAddress",
	"createdAt"
) VALUES ($1, $2, $3, $4, $5, $6, NULLIF($7, ''), NOW())
`, uuid.NewString(), nullableString(userID), action, nullableStringValue(targetType), nullableStringValue(targetID), rawDetails, strings.TrimSpace(ipAddress))
	if err != nil {
		return fmt.Errorf("insert audit log: %w", err)
	}
	return nil
}

func fakeInfo() shareInfoResponse {
	return shareInfoResponse{
		ID:          uuid.NewString(),
		SecretName:  "Shared Secret",
		SecretType:  "LOGIN",
		HasPin:      true,
		ExpiresAt:   time.Unix(0, 0).UTC().Format(time.RFC3339),
		IsExpired:   true,
		IsExhausted: false,
		IsRevoked:   false,
	}
}

func hashToken(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func deriveKeyFromToken(token, shareID, saltBase64 string) ([]byte, error) {
	ikm, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("decode token: %w", err)
	}

	var salt []byte
	if strings.TrimSpace(saltBase64) != "" {
		salt, err = base64.StdEncoding.DecodeString(saltBase64)
		if err != nil {
			return nil, fmt.Errorf("decode token salt: %w", err)
		}
	}

	key := make([]byte, 32)
	reader := hkdf.New(sha256.New, ikm, salt, []byte(shareID))
	if _, err := io.ReadFull(reader, key); err != nil {
		return nil, fmt.Errorf("derive hkdf key: %w", err)
	}
	return key, nil
}

func deriveKeyFromTokenAndPin(token, pin, saltHex string) ([]byte, error) {
	salt, err := hex.DecodeString(saltHex)
	if err != nil {
		return nil, fmt.Errorf("decode pin salt: %w", err)
	}
	return argon2.IDKey([]byte(token+pin), salt, 3, 64*1024, 1, 32), nil
}

func decryptPayload(cipherHex, ivHex, tagHex string, key []byte) (string, error) {
	ciphertext, err := hex.DecodeString(cipherHex)
	if err != nil {
		return "", fmt.Errorf("decode ciphertext: %w", err)
	}
	iv, err := hex.DecodeString(ivHex)
	if err != nil {
		return "", fmt.Errorf("decode iv: %w", err)
	}
	tag, err := hex.DecodeString(tagHex)
	if err != nil {
		return "", fmt.Errorf("decode tag: %w", err)
	}

	block, err := aes.NewCipher(key)
	if err != nil {
		return "", fmt.Errorf("new cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, len(iv))
	if err != nil {
		return "", fmt.Errorf("new gcm: %w", err)
	}

	plaintext, err := gcm.Open(nil, iv, append(ciphertext, tag...), nil)
	if err != nil {
		return "", err
	}
	return string(plaintext), nil
}

func clientIP(r *http.Request) string {
	for _, header := range []string{"X-Real-IP", "X-Forwarded-For"} {
		value := strings.TrimSpace(r.Header.Get(header))
		if value == "" {
			continue
		}
		if header == "X-Forwarded-For" {
			value = strings.TrimSpace(strings.Split(value, ",")[0])
		}
		if value != "" {
			return value
		}
	}
	host, _, err := net.SplitHostPort(strings.TrimSpace(r.RemoteAddr))
	if err == nil && host != "" {
		return host
	}
	return strings.TrimSpace(r.RemoteAddr)
}

func zero(buf []byte) {
	for i := range buf {
		buf[i] = 0
	}
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return strings.TrimSpace(*value)
}

func nullableStringValue(value string) any {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return strings.TrimSpace(value)
}
