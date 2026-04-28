package tunnelegress

import (
	"context"
	"encoding/json"

	"github.com/dnviti/arsenale/backend/pkg/egresspolicy"
)

type Check struct {
	Policy       json.RawMessage
	Protocol     string
	TargetHost   string
	TargetPort   int
	UserID       string
	TeamIDs      []string
	GatewayID    string
	ConnectionID string
	IPAddress    string
}

func Authorize(ctx context.Context, check Check) egresspolicy.Decision {
	return egresspolicy.AuthorizeRaw(ctx, check.Policy, egresspolicy.Request{
		Protocol: check.Protocol,
		Host:     check.TargetHost,
		Port:     check.TargetPort,
		UserID:   check.UserID,
		TeamIDs:  check.TeamIDs,
	}, egresspolicy.DefaultOptions())
}
