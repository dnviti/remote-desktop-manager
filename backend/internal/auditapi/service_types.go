package auditapi

import (
	"context"
	"encoding/json"
	"time"

	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type membershipResolver interface {
	ResolveMembership(ctx context.Context, userID, tenantID string) (*tenantauth.Membership, error)
	ResolveSessionVisibility(ctx context.Context, userID, tenantID string) (*tenantauth.SessionVisibility, error)
}

type Service struct {
	DB         *pgxpool.Pool
	TenantAuth membershipResolver
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string { return e.message }

type auditGateway struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type geoSummaryPoint struct {
	Lat      float64   `json:"lat"`
	Lng      float64   `json:"lng"`
	Country  string    `json:"country"`
	City     string    `json:"city"`
	Count    int       `json:"count"`
	LastSeen time.Time `json:"lastSeen"`
}

type auditLogEntry struct {
	ID         string          `json:"id"`
	Action     string          `json:"action"`
	TargetType *string         `json:"targetType"`
	TargetID   *string         `json:"targetId"`
	Details    json.RawMessage `json:"details"`
	IPAddress  *string         `json:"ipAddress"`
	GatewayID  *string         `json:"gatewayId"`
	GeoCountry *string         `json:"geoCountry"`
	GeoCity    *string         `json:"geoCity"`
	GeoCoords  []float64       `json:"geoCoords"`
	Flags      []string        `json:"flags"`
	CreatedAt  time.Time       `json:"createdAt"`
}

type tenantAuditLogEntry struct {
	auditLogEntry
	UserID    *string `json:"userId"`
	UserName  *string `json:"userName"`
	UserEmail *string `json:"userEmail"`
}

type paginatedAuditLogs struct {
	Data       []auditLogEntry `json:"data"`
	Total      int             `json:"total"`
	Page       int             `json:"page"`
	Limit      int             `json:"limit"`
	TotalPages int             `json:"totalPages"`
}

type paginatedTenantAuditLogs struct {
	Data       []tenantAuditLogEntry `json:"data"`
	Total      int                   `json:"total"`
	Page       int                   `json:"page"`
	Limit      int                   `json:"limit"`
	TotalPages int                   `json:"totalPages"`
}

type connectionAuditUser struct {
	ID       string  `json:"id"`
	Username *string `json:"username"`
	Email    string  `json:"email"`
}

type sessionRecordingResponse struct {
	ID           string     `json:"id"`
	SessionID    *string    `json:"sessionId"`
	UserID       string     `json:"userId"`
	ConnectionID string     `json:"connectionId"`
	Protocol     string     `json:"protocol"`
	FilePath     string     `json:"filePath"`
	FileSize     *int       `json:"fileSize"`
	Duration     *int       `json:"duration"`
	Width        *int       `json:"width"`
	Height       *int       `json:"height"`
	Format       string     `json:"format"`
	Status       string     `json:"status"`
	CreatedAt    time.Time  `json:"createdAt"`
	CompletedAt  *time.Time `json:"completedAt"`
	Connection   any        `json:"connection"`
}

type auditQuery struct {
	Page        int
	Limit       int
	Action      *string
	StartDate   *time.Time
	EndDate     *time.Time
	Search      string
	TargetType  string
	IPAddress   string
	GatewayID   string
	GeoCountry  string
	SortBy      string
	SortOrder   string
	FlaggedOnly bool
	UserID      string
}
