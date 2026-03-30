package passwordrotationapi

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

type secretRecord struct {
	ID                    string
	Type                  string
	Scope                 string
	UserID                string
	TeamID                *string
	TenantID              *string
	TeamTenantID          *string
	TargetRotationEnabled bool
	RotationIntervalDays  int
	LastRotatedAt         *time.Time
}

type rotationStatusResponse struct {
	Enabled        bool       `json:"enabled"`
	IntervalDays   int        `json:"intervalDays"`
	LastRotatedAt  *time.Time `json:"lastRotatedAt"`
	NextRotationAt *time.Time `json:"nextRotationAt"`
}

type rotationHistoryEntry struct {
	ID           string    `json:"id"`
	Status       string    `json:"status"`
	Trigger      string    `json:"trigger"`
	TargetOS     string    `json:"targetOS"`
	TargetHost   string    `json:"targetHost"`
	TargetUser   string    `json:"targetUser"`
	ErrorMessage *string   `json:"errorMessage"`
	DurationMs   *int      `json:"durationMs"`
	CreatedAt    time.Time `json:"createdAt"`
}
