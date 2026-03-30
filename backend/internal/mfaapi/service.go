package mfaapi

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var ErrLegacySMSMFAFlow = errors.New("legacy sms mfa flow required")

type Service struct {
	DB        *pgxpool.Pool
	Redis     *redis.Client
	ServerKey []byte
}

type totpStatusResponse struct {
	Enabled bool `json:"enabled"`
}

type smsStatusResponse struct {
	Enabled       bool    `json:"enabled"`
	PhoneNumber   *string `json:"phoneNumber"`
	PhoneVerified bool    `json:"phoneVerified"`
}

type webauthnStatusResponse struct {
	Enabled         bool `json:"enabled"`
	CredentialCount int  `json:"credentialCount"`
}

type webauthnCredentialInfo struct {
	ID           string  `json:"id"`
	CredentialID string  `json:"credentialId"`
	FriendlyName string  `json:"friendlyName"`
	DeviceType   *string `json:"deviceType"`
	BackedUp     bool    `json:"backedUp"`
	LastUsedAt   *string `json:"lastUsedAt"`
	CreatedAt    string  `json:"createdAt"`
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type totpUser struct {
	ID                  string
	Email               string
	TOTPEnabled         bool
	EncryptedTOTPSecret *string
	TOTPSecretIV        *string
	TOTPSecretTag       *string
	TOTPSecret          *string
}

type totpSetupResponse struct {
	Secret     string `json:"secret"`
	OtpauthURI string `json:"otpauthUri"`
}

type totpEnabledResponse struct {
	Enabled bool `json:"enabled"`
}

type phoneSetupPayload struct {
	PhoneNumber string `json:"phoneNumber"`
}

type codePayload struct {
	Code string `json:"code"`
}

func requestErr(status int, message string) error {
	return &requestError{status: status, message: message}
}

func invalidCodeError() error {
	return requestErr(http.StatusBadRequest, "Invalid TOTP code")
}
