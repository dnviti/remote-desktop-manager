package dbauditapi

import (
	"time"

	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Service struct {
	DB         *pgxpool.Pool
	TenantAuth tenantauth.Service
}

const maxRegexLength = 500

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type dbAuditLogEntry struct {
	ID              string    `json:"id"`
	UserID          string    `json:"userId"`
	ConnectionID    string    `json:"connectionId"`
	TenantID        *string   `json:"tenantId"`
	QueryText       string    `json:"queryText"`
	QueryType       string    `json:"queryType"`
	TablesAccessed  []string  `json:"tablesAccessed"`
	RowsAffected    *int      `json:"rowsAffected"`
	ExecutionTimeMS *int      `json:"executionTimeMs"`
	Blocked         bool      `json:"blocked"`
	BlockReason     *string   `json:"blockReason"`
	ExecutionPlan   any       `json:"executionPlan"`
	CreatedAt       time.Time `json:"createdAt"`
	UserName        *string   `json:"userName"`
	UserEmail       *string   `json:"userEmail"`
	ConnectionName  *string   `json:"connectionName"`
}

type paginatedDbAuditLogs struct {
	Data       []dbAuditLogEntry `json:"data"`
	Total      int               `json:"total"`
	Page       int               `json:"page"`
	Limit      int               `json:"limit"`
	TotalPages int               `json:"totalPages"`
}

type dbAuditConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type dbAuditUser struct {
	ID       string  `json:"id"`
	Username *string `json:"username"`
	Email    string  `json:"email"`
}

type firewallRule struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	Name        string    `json:"name"`
	Pattern     string    `json:"pattern"`
	Action      string    `json:"action"`
	Scope       *string   `json:"scope"`
	Description *string   `json:"description"`
	Enabled     bool      `json:"enabled"`
	Priority    int       `json:"priority"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type maskingPolicy struct {
	ID            string    `json:"id"`
	TenantID      string    `json:"tenantId"`
	Name          string    `json:"name"`
	ColumnPattern string    `json:"columnPattern"`
	Strategy      string    `json:"strategy"`
	ExemptRoles   []string  `json:"exemptRoles"`
	Scope         *string   `json:"scope"`
	Description   *string   `json:"description"`
	Enabled       bool      `json:"enabled"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt"`
}

type rateLimitPolicy struct {
	ID          string    `json:"id"`
	TenantID    string    `json:"tenantId"`
	Name        string    `json:"name"`
	QueryType   *string   `json:"queryType"`
	WindowMS    int       `json:"windowMs"`
	MaxQueries  int       `json:"maxQueries"`
	BurstMax    int       `json:"burstMax"`
	ExemptRoles []string  `json:"exemptRoles"`
	Scope       *string   `json:"scope"`
	Action      string    `json:"action"`
	Enabled     bool      `json:"enabled"`
	Priority    int       `json:"priority"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type dbAuditQuery struct {
	Page         int
	Limit        int
	UserID       string
	ConnectionID string
	QueryType    string
	Blocked      *bool
	Search       string
	StartDate    *time.Time
	EndDate      *time.Time
	SortBy       string
	SortOrder    string
}
