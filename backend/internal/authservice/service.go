package authservice

import (
	"errors"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB               *pgxpool.Pool
	Redis            *redis.Client
	JWTSecret        []byte
	ServerKey        []byte
	ClientURL        string
	TokenBinding     bool
	EmailVerify      bool
	RefreshCookie    string
	CSRFCookie       string
	CookieSecure     bool
	CookieSameSite   http.SameSite
	RefreshCookieTTL time.Duration
	AccessTokenTTL   time.Duration
	VaultTTL         time.Duration
}

type loginMembership struct {
	TenantID                 string
	Name                     string
	Slug                     string
	Role                     string
	Status                   string
	IsActive                 bool
	JoinedAt                 time.Time
	MFARequired              bool
	IPAllowlistEnabled       bool
	JWTExpiresInSeconds      *int
	JWTRefreshExpiresSeconds *int
	AccountLockoutThreshold  *int
	AccountLockoutDurationMs *int
}

type loginResult struct {
	AccessToken       string             `json:"accessToken"`
	CSRFToken         string             `json:"csrfToken"`
	User              loginUserResponse  `json:"user"`
	TenantMemberships []tenantMembership `json:"tenantMemberships"`
}

type loginUserResponse struct {
	ID         string  `json:"id"`
	Email      string  `json:"email"`
	Username   *string `json:"username"`
	AvatarData *string `json:"avatarData"`
	TenantID   string  `json:"tenantId,omitempty"`
	TenantRole string  `json:"tenantRole,omitempty"`
}

type tenantMembership struct {
	TenantID string `json:"tenantId"`
	Name     string `json:"name"`
	Slug     string `json:"slug"`
	Role     string `json:"role"`
	Status   string `json:"status"`
	Pending  bool   `json:"pending"`
	IsActive bool   `json:"isActive"`
}

type issuedLogin struct {
	accessToken       string
	refreshToken      string
	refreshExpires    time.Duration
	user              loginUserResponse
	tenantMemberships []tenantMembership
}

type requestError struct {
	status  int
	message string
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

var ErrLegacyLogin = errors.New("legacy login required")
var ErrLegacyRegister = errors.New("legacy register required")
var ErrLegacyEmailFlow = errors.New("legacy email flow required")

type loginFlow struct {
	issued           *issuedLogin
	requiresMFA      bool
	requiresTOTP     bool
	methods          []string
	mfaSetupRequired bool
	tempToken        string
}

func (e *requestError) Error() string {
	return e.message
}

type loginUser struct {
	ID                      string
	Email                   string
	Username                *string
	AvatarData              *string
	PasswordHash            *string
	VaultSalt               *string
	EncryptedVaultKey       *string
	VaultKeyIV              *string
	VaultKeyTag             *string
	Enabled                 bool
	EmailVerified           bool
	TOTPEnabled             bool
	SMSMFAEnabled           bool
	WebAuthnEnabled         bool
	FailedLoginAttempts     int
	LockedUntil             *time.Time
	Memberships             []loginMembership
	ActiveTenant            *loginMembership
	HasLegacyOrAdvancedAuth bool
}
