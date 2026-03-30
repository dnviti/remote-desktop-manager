package vaultfolders

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

type folderScope string

const (
	scopePersonal folderScope = "PERSONAL"
	scopeTeam     folderScope = "TEAM"
	scopeTenant   folderScope = "TENANT"
)

type folderRecord struct {
	ID        string      `json:"id"`
	Name      string      `json:"name"`
	ParentID  *string     `json:"parentId"`
	UserID    string      `json:"userId"`
	Scope     folderScope `json:"scope"`
	TeamID    *string     `json:"teamId"`
	TenantID  *string     `json:"tenantId"`
	SortOrder int         `json:"sortOrder"`
	CreatedAt time.Time   `json:"createdAt"`
	UpdatedAt time.Time   `json:"updatedAt"`
	TeamName  *string     `json:"teamName,omitempty"`
}

type listResponse struct {
	Personal []folderRecord `json:"personal"`
	Team     []folderRecord `json:"team"`
	Tenant   []folderRecord `json:"tenant"`
}

type createPayload struct {
	Name     string      `json:"name"`
	Scope    folderScope `json:"scope"`
	ParentID *string     `json:"parentId"`
	TeamID   *string     `json:"teamId"`
}

type updatePayload struct {
	Name     *string `json:"name"`
	ParentID *string `json:"parentId"`
}
