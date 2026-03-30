package checkouts

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

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

type userSummary struct {
	Email    string  `json:"email"`
	Username *string `json:"username"`
}

type checkoutEntry struct {
	ID              string       `json:"id"`
	SecretID        *string      `json:"secretId"`
	ConnectionID    *string      `json:"connectionId"`
	RequesterID     string       `json:"requesterId"`
	ApproverID      *string      `json:"approverId"`
	Status          string       `json:"status"`
	DurationMinutes int          `json:"durationMinutes"`
	Reason          *string      `json:"reason"`
	ExpiresAt       *time.Time   `json:"expiresAt"`
	CreatedAt       time.Time    `json:"createdAt"`
	UpdatedAt       time.Time    `json:"updatedAt"`
	Requester       userSummary  `json:"requester"`
	Approver        *userSummary `json:"approver"`
	SecretName      *string      `json:"secretName"`
	ConnectionName  *string      `json:"connectionName"`
}

type paginatedResponse struct {
	Data  []checkoutEntry `json:"data"`
	Total int             `json:"total"`
}

type createPayload struct {
	SecretID        *string `json:"secretId"`
	ConnectionID    *string `json:"connectionId"`
	DurationMinutes int     `json:"durationMinutes"`
	Reason          *string `json:"reason"`
}
