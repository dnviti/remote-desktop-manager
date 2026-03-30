package users

import (
	"encoding/json"
	"errors"
	"regexp"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	ServerEncryptionKey []byte
}

var adminRoles = map[string]struct{}{
	"OWNER": {},
	"ADMIN": {},
}

type Profile struct {
	ID                 string          `json:"id"`
	Email              string          `json:"email"`
	Username           *string         `json:"username"`
	AvatarData         *string         `json:"avatarData"`
	SSHDefaults        json.RawMessage `json:"sshDefaults"`
	RDPDefaults        json.RawMessage `json:"rdpDefaults"`
	CreatedAt          time.Time       `json:"createdAt"`
	VaultSetupComplete bool            `json:"vaultSetupComplete"`
	OAuthAccounts      []OAuthAccount  `json:"oauthAccounts"`
	HasPassword        bool            `json:"hasPassword"`
}

type OAuthAccount struct {
	Provider      string    `json:"provider"`
	ProviderEmail *string   `json:"providerEmail"`
	CreatedAt     time.Time `json:"createdAt"`
}

type updateProfileResult struct {
	ID         string  `json:"id"`
	Email      string  `json:"email"`
	Username   *string `json:"username"`
	AvatarData *string `json:"avatarData"`
}

type jsonPreferenceResult struct {
	ID         string          `json:"id"`
	Preference json.RawMessage `json:"preference"`
}

type avatarResult struct {
	ID         string  `json:"id"`
	AvatarData *string `json:"avatarData"`
}

type domainProfile struct {
	DomainName        *string `json:"domainName"`
	DomainUsername    *string `json:"domainUsername"`
	HasDomainPassword bool    `json:"hasDomainPassword"`
}

type domainProfilePatch struct {
	DomainName        *string
	DomainUsername    *string
	DomainPassword    *string
	HasDomainName     bool
	HasDomainUsername bool
	HasDomainPassword bool
}

type searchResult struct {
	ID         string  `json:"id"`
	Email      string  `json:"email"`
	Username   *string `json:"username"`
	AvatarData *string `json:"avatarData"`
}

type notificationSchedule struct {
	DNDEnabled         bool    `json:"dndEnabled"`
	QuietHoursStart    *string `json:"quietHoursStart"`
	QuietHoursEnd      *string `json:"quietHoursEnd"`
	QuietHoursTimezone *string `json:"quietHoursTimezone"`
}

type notificationSchedulePatch struct {
	DNDEnabled            *bool
	QuietHoursStart       *string
	QuietHoursEnd         *string
	QuietHoursTimezone    *string
	HasDNDEnabled         bool
	HasQuietHoursStart    bool
	HasQuietHoursEnd      bool
	HasQuietHoursTimezone bool
}

const maxAvatarSize = 200 * 1024
const bcryptRounds = 12
const verificationSessionTTL = 15 * time.Minute
const verificationConsumeWindow = 5 * time.Minute
const verificationMaxAttempts = 5
const verificationSessionKeyPrefix = "identity:verification:"
const hibpAPIURL = "https://api.pwnedpasswords.com/range/"
const hibpTimeout = 5 * time.Second
const hibpUserAgent = "Arsenale-PasswordCheck"

var hhmmPattern = regexp.MustCompile(`^([01]\d|2[0-3]):[0-5]\d$`)
var errVaultLocked = errors.New("Vault must be unlocked to set domain password")
var ErrLegacyPasswordChangeInitiation = errors.New("legacy password-change initiation required")
var ErrLegacyIdentityVerification = errors.New("legacy identity verification required")
var ErrLegacyEmailChangeFlow = errors.New("legacy email change flow required")
var errNoVerificationMethod = errors.New("No verification method available. Please set up a password or enable MFA.")

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type passwordChangeInitResult struct {
	SkipVerification bool                   `json:"skipVerification"`
	VerificationID   string                 `json:"verificationId,omitempty"`
	Method           string                 `json:"method,omitempty"`
	Metadata         map[string]interface{} `json:"metadata,omitempty"`
}

type passwordChangeResult struct {
	Success     bool   `json:"success"`
	RecoveryKey string `json:"recoveryKey"`
}

type identityInitResult struct {
	VerificationID string                 `json:"verificationId"`
	Method         string                 `json:"method"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

type emailChangeInitResult struct {
	Flow           string                 `json:"flow"`
	VerificationID string                 `json:"verificationId,omitempty"`
	Method         string                 `json:"method,omitempty"`
	Metadata       map[string]interface{} `json:"metadata,omitempty"`
}

type verificationSession struct {
	UserID         string                 `json:"userId"`
	Method         string                 `json:"method"`
	Purpose        string                 `json:"purpose"`
	Confirmed      bool                   `json:"confirmed"`
	ConfirmedAt    *int64                 `json:"confirmedAt"`
	Attempts       int                    `json:"attempts"`
	ExpiresAt      int64                  `json:"expiresAt"`
	EmailOtpHash   string                 `json:"emailOtpHash,omitempty"`
	WebAuthnOption map[string]interface{} `json:"webauthnOptions,omitempty"`
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}
