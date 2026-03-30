package tenants

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/authservice"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	TenantAuth          tenantauth.Service
	AuthService         *authservice.Service
	ServerEncryptionKey []byte
}

type tenantResponse struct {
	ID                            string          `json:"id"`
	Name                          string          `json:"name"`
	Slug                          string          `json:"slug"`
	MFARequired                   bool            `json:"mfaRequired"`
	VaultAutoLockMaxMinutes       *int            `json:"vaultAutoLockMaxMinutes"`
	UserCount                     int             `json:"userCount"`
	DefaultSessionTimeoutSeconds  int             `json:"defaultSessionTimeoutSeconds"`
	MaxConcurrentSessions         int             `json:"maxConcurrentSessions"`
	AbsoluteSessionTimeoutSeconds int             `json:"absoluteSessionTimeoutSeconds"`
	DLPDisableCopy                bool            `json:"dlpDisableCopy"`
	DLPDisablePaste               bool            `json:"dlpDisablePaste"`
	DLPDisableDownload            bool            `json:"dlpDisableDownload"`
	DLPDisableUpload              bool            `json:"dlpDisableUpload"`
	EnforcedConnectionSettings    json.RawMessage `json:"enforcedConnectionSettings"`
	TunnelDefaultEnabled          bool            `json:"tunnelDefaultEnabled"`
	TunnelAutoTokenRotation       bool            `json:"tunnelAutoTokenRotation"`
	TunnelTokenRotationDays       int             `json:"tunnelTokenRotationDays"`
	TunnelRequireForRemote        bool            `json:"tunnelRequireForRemote"`
	TunnelTokenMaxLifetimeDays    *int            `json:"tunnelTokenMaxLifetimeDays"`
	TunnelAgentAllowedCIDRs       []string        `json:"tunnelAgentAllowedCidrs"`
	LoginRateLimitWindowMs        *int            `json:"loginRateLimitWindowMs"`
	LoginRateLimitMaxAttempts     *int            `json:"loginRateLimitMaxAttempts"`
	AccountLockoutThreshold       *int            `json:"accountLockoutThreshold"`
	AccountLockoutDurationMs      *int            `json:"accountLockoutDurationMs"`
	ImpossibleTravelSpeedKmh      *int            `json:"impossibleTravelSpeedKmh"`
	JWTExpiresInSeconds           *int            `json:"jwtExpiresInSeconds"`
	JWTRefreshExpiresInSeconds    *int            `json:"jwtRefreshExpiresInSeconds"`
	VaultDefaultTTLMinutes        *int            `json:"vaultDefaultTtlMinutes"`
	RecordingEnabled              bool            `json:"recordingEnabled"`
	RecordingRetentionDays        *int            `json:"recordingRetentionDays"`
	FileUploadMaxSizeBytes        *int            `json:"fileUploadMaxSizeBytes"`
	UserDriveQuotaBytes           *int            `json:"userDriveQuotaBytes"`
	TeamCount                     int             `json:"teamCount"`
	CreatedAt                     time.Time       `json:"createdAt"`
	UpdatedAt                     time.Time       `json:"updatedAt"`
}

type tenantMembershipResponse struct {
	TenantID string    `json:"tenantId"`
	Name     string    `json:"name"`
	Slug     string    `json:"slug"`
	Role     string    `json:"role"`
	Status   string    `json:"status"`
	Pending  bool      `json:"pending"`
	IsActive bool      `json:"isActive"`
	JoinedAt time.Time `json:"joinedAt"`
}

type ipAllowlistResponse struct {
	Enabled bool     `json:"enabled"`
	Mode    string   `json:"mode"`
	Entries []string `json:"entries"`
}

type tenantUserResponse struct {
	ID            string     `json:"id"`
	Email         string     `json:"email"`
	Username      *string    `json:"username"`
	AvatarData    *string    `json:"avatarData"`
	Role          string     `json:"role"`
	Status        string     `json:"status"`
	Pending       bool       `json:"pending"`
	TOTPEnabled   bool       `json:"totpEnabled"`
	SMSMFAEnabled bool       `json:"smsMfaEnabled"`
	Enabled       bool       `json:"enabled"`
	CreatedAt     time.Time  `json:"createdAt"`
	ExpiresAt     *time.Time `json:"expiresAt"`
	Expired       bool       `json:"expired"`
}

type tenantUserProfileTeam struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type tenantUserProfileResponse struct {
	ID              string                  `json:"id"`
	Username        *string                 `json:"username"`
	AvatarData      *string                 `json:"avatarData"`
	Role            string                  `json:"role"`
	JoinedAt        time.Time               `json:"joinedAt"`
	Teams           []tenantUserProfileTeam `json:"teams"`
	Email           *string                 `json:"email,omitempty"`
	TOTPEnabled     *bool                   `json:"totpEnabled,omitempty"`
	SMSMFAEnabled   *bool                   `json:"smsMfaEnabled,omitempty"`
	WebAuthnEnabled *bool                   `json:"webauthnEnabled,omitempty"`
	UpdatedAt       *time.Time              `json:"updatedAt,omitempty"`
	LastActivity    *time.Time              `json:"lastActivity"`
}

type tenantUserPermissionsResponse struct {
	Role        string          `json:"role"`
	Permissions map[string]bool `json:"permissions"`
	Overrides   map[string]bool `json:"overrides"`
	Defaults    map[string]bool `json:"defaults"`
}

type tenantManagedUserResponse struct {
	ID       string  `json:"id"`
	Email    string  `json:"email"`
	Username *string `json:"username,omitempty"`
	Role     string  `json:"role"`
	Enabled  *bool   `json:"enabled,omitempty"`
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

func requireOwnTenant(claims authn.Claims, tenantID string) *requestError {
	if claims.TenantID == "" {
		return &requestError{status: http.StatusForbidden, message: "You must belong to an organization to perform this action"}
	}
	if tenantID != claims.TenantID {
		return &requestError{status: http.StatusForbidden, message: "Access denied"}
	}
	return nil
}

func (s Service) requireManageUsersPermission(ctx context.Context, claims authn.Claims) *requestError {
	if s.TenantAuth.DB == nil {
		if !claimsCanAdminTenant(claims.TenantRole) {
			return &requestError{status: http.StatusForbidden, message: "Insufficient tenant role"}
		}
		return nil
	}

	membership, err := s.TenantAuth.ResolveMembership(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return &requestError{status: http.StatusServiceUnavailable, message: err.Error()}
	}
	if membership == nil || !membership.Permissions[tenantauth.CanManageUsers] {
		return &requestError{status: http.StatusForbidden, message: "Insufficient permissions"}
	}
	return nil
}

func claimsCanAdminTenant(role string) bool {
	switch role = strings.ToUpper(strings.TrimSpace(role)); role {
	case "OWNER", "ADMIN":
		return true
	default:
		return false
	}
}

func nullInt(value sql.NullInt32) *int {
	if !value.Valid {
		return nil
	}
	converted := int(value.Int32)
	return &converted
}
