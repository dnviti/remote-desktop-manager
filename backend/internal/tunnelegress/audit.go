package tunnelegress

import (
	"context"
	"encoding/json"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

type DeniedAudit struct {
	UserID       string
	GatewayID    string
	ConnectionID string
	Protocol     string
	TargetHost   string
	TargetPort   int
	Reason       string
	IPAddress    string
}

func InsertDeniedAudit(ctx context.Context, db *pgxpool.Pool, event DeniedAudit) {
	if db == nil || strings.TrimSpace(event.GatewayID) == "" {
		return
	}

	details, err := json.Marshal(map[string]any{
		"gatewayId":    strings.TrimSpace(event.GatewayID),
		"connectionId": strings.TrimSpace(event.ConnectionID),
		"protocol":     strings.ToUpper(strings.TrimSpace(event.Protocol)),
		"targetHost":   strings.TrimSpace(event.TargetHost),
		"targetPort":   event.TargetPort,
		"reason":       strings.TrimSpace(event.Reason),
	})
	if err != nil {
		return
	}

	_, _ = db.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details, "ipAddress", "geoCoords", flags)
VALUES ($1, NULLIF($2, ''), 'TUNNEL_EGRESS_DENIED'::"AuditAction", 'Gateway', NULLIF($3, ''), $4::jsonb, NULLIF($5, ''), ARRAY[]::double precision[], ARRAY[]::text[])
`,
		uuid.NewString(),
		strings.TrimSpace(event.UserID),
		strings.TrimSpace(event.GatewayID),
		string(details),
		strings.TrimSpace(event.IPAddress),
	)
}
