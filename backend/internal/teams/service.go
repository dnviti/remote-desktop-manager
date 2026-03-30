package teams

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	ServerEncryptionKey []byte
	VaultTTL            time.Duration
}

type teamResponse struct {
	ID          string     `json:"id"`
	Name        string     `json:"name"`
	Description *string    `json:"description"`
	MemberCount int        `json:"memberCount"`
	MyRole      string     `json:"myRole"`
	CreatedAt   time.Time  `json:"createdAt"`
	UpdatedAt   *time.Time `json:"updatedAt,omitempty"`
}

type teamMemberResponse struct {
	UserID     string     `json:"userId"`
	Email      string     `json:"email"`
	Username   *string    `json:"username"`
	AvatarData *string    `json:"avatarData"`
	Role       string     `json:"role"`
	JoinedAt   time.Time  `json:"joinedAt"`
	ExpiresAt  *time.Time `json:"expiresAt"`
	Expired    bool       `json:"expired"`
}

type createTeamPayload struct {
	Name        string  `json:"name"`
	Description *string `json:"description"`
}

type addMemberPayload struct {
	UserID    string       `json:"userId"`
	Role      string       `json:"role"`
	ExpiresAt optionalTime `json:"expiresAt"`
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

type optionalString struct {
	Present bool
	Value   *string
}

func (o *optionalString) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type updateTeamPayload struct {
	Name        optionalString `json:"name"`
	Description optionalString `json:"description"`
}

type updateMemberRolePayload struct {
	Role string `json:"role"`
}

type optionalTime struct {
	Present bool
	Value   *time.Time
}

func (o *optionalTime) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var raw string
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(raw))
	if err != nil {
		return err
	}
	o.Value = &parsed
	return nil
}

type updateMemberExpiryPayload struct {
	ExpiresAt optionalTime `json:"expiresAt"`
}

type membership struct {
	Role     string
	TenantID string
}

func requireTenantMembership(claims authn.Claims) *requestError {
	if strings.TrimSpace(claims.TenantID) == "" {
		return &requestError{status: http.StatusForbidden, message: "You must belong to an organization to perform this action"}
	}
	return nil
}
