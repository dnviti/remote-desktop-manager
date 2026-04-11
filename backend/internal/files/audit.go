package files

import (
	"context"
	"encoding/json"

	"github.com/google/uuid"
)

func (s Service) insertAuditLog(ctx context.Context, userID, action, targetID, ipAddress string, details map[string]any) error {
	if s.DB == nil {
		return nil
	}

	rawDetails, err := json.Marshal(details)
	if err != nil {
		return err
	}

	_, err = s.DB.Exec(
		ctx,
		`INSERT INTO "AuditLog" (
			 id, "userId", action, "targetType", "targetId", details, "ipAddress", "geoCoords", flags
		 ) VALUES (
			 $1, $2, $3::"AuditAction", $4, $5, $6::jsonb, $7, ARRAY[]::double precision[], ARRAY[]::text[]
		 )`,
		uuid.NewString(),
		nilIfEmptyString(userID),
		action,
		nilIfEmptyString("Connection"),
		nilIfEmptyString(targetID),
		string(rawDetails),
		nilIfEmptyString(ipAddress),
	)
	return err
}

func nilIfEmptyString(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
