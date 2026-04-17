package recordingsapi

import (
	"context"
	"encoding/json"
	"time"

	"github.com/dnviti/arsenale/backend/internal/tenantauth"
	"github.com/jackc/pgx/v5/pgxpool"
)

type sessionVisibilityResolver interface {
	ResolveSessionVisibility(ctx context.Context, userID, tenantID string) (*tenantauth.SessionVisibility, error)
}

type Service struct {
	DB                    *pgxpool.Pool
	TenantAuth            sessionVisibilityResolver
	RecordingPath         string
	GuacencServiceURL     string
	GuacencUseTLS         bool
	GuacencTLSCA          string
	GuacencAuthToken      string
	GuacencTimeout        time.Duration
	GuacencRecordingPath  string
	AsciicastConverterURL string
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type recordingConnection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Host string `json:"host"`
}

type recordingUser struct {
	ID       string  `json:"id"`
	Email    string  `json:"email"`
	Username *string `json:"username"`
}

type recordingResponse struct {
	ID           string              `json:"id"`
	SessionID    *string             `json:"sessionId"`
	UserID       string              `json:"userId"`
	ConnectionID string              `json:"connectionId"`
	Protocol     string              `json:"protocol"`
	FilePath     string              `json:"filePath"`
	FileSize     *int                `json:"fileSize"`
	Duration     *int                `json:"duration"`
	Width        *int                `json:"width"`
	Height       *int                `json:"height"`
	Format       string              `json:"format"`
	Status       string              `json:"status"`
	CreatedAt    time.Time           `json:"createdAt"`
	CompletedAt  *time.Time          `json:"completedAt"`
	Connection   recordingConnection `json:"connection"`
	User         *recordingUser      `json:"user,omitempty"`
}

type recordingsResponse struct {
	Recordings []recordingResponse `json:"recordings"`
	Total      int                 `json:"total"`
}

type auditTrailEntry struct {
	ID         string          `json:"id"`
	UserID     *string         `json:"userId"`
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

type auditTrailResponse struct {
	Data    []auditTrailEntry `json:"data"`
	HasMore bool              `json:"hasMore"`
}

type listQuery struct {
	ConnectionID *string
	Protocol     *string
	Status       *string
	Limit        int
	Offset       int
}
