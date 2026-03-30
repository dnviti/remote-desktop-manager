package vaultapi

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
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

type statusResponse struct {
	Unlocked           bool     `json:"unlocked"`
	VaultNeedsRecovery bool     `json:"vaultNeedsRecovery"`
	MFAUnlockAvailable bool     `json:"mfaUnlockAvailable"`
	MFAUnlockMethods   []string `json:"mfaUnlockMethods"`
}

type autoLockResponse struct {
	AutoLockMinutes *int `json:"autoLockMinutes"`
	EffectiveMinute int  `json:"effectiveMinutes"`
	TenantMaxMinute *int `json:"tenantMaxMinutes"`
}

type userVaultSettings struct {
	VaultNeedsRecovery bool
	WebAuthnEnabled    bool
	TOTPEnabled        bool
	SMSMFAEnabled      bool
	AutoLockMinutes    *int
}

type tenantVaultPolicy struct {
	MaxMinutes     *int
	DefaultMinutes *int
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type unlockPayload struct {
	Password string `json:"password"`
}

type recoverPayload struct {
	RecoveryKey string `json:"recoveryKey"`
	Password    string `json:"password"`
}

type explicitResetPayload struct {
	Password     string `json:"password"`
	ConfirmReset bool   `json:"confirmReset"`
}

type revealPayload struct {
	ConnectionID string `json:"connectionId"`
	Password     string `json:"password"`
}

type codePayload struct {
	Code string `json:"code"`
}

type vaultCredentials struct {
	PasswordHash              *string
	VaultSalt                 *string
	EncryptedVaultKey         *string
	VaultKeyIV                *string
	VaultKeyTag               *string
	VaultNeedsRecovery        bool
	EncryptedVaultRecoveryKey *string
	VaultRecoveryKeyIV        *string
	VaultRecoveryKeyTag       *string
	VaultRecoveryKeySalt      *string
}

type totpUnlockUser struct {
	TOTPEnabled         bool
	EncryptedTOTPSecret *string
	TOTPSecretIV        *string
	TOTPSecretTag       *string
	TOTPSecret          *string
}

func (e *requestError) Error() string {
	return e.message
}
