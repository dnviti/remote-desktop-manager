package dbsessions

import (
	"encoding/json"
	"errors"

	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

var ErrQueryRuntimeUnsupported = errors.New("database session runtime is unsupported for this session")

type ownedQueryRequest struct {
	SQL string `json:"sql"`
}

type ownedIntrospectionRequest struct {
	Type   string `json:"type"`
	Target string `json:"target,omitempty"`
}

type ownedConnectionSnapshot struct {
	ID         string
	Host       string
	Port       int
	DBSettings json.RawMessage
}

type ownedQueryRuntime struct {
	State                   *sessions.SessionState
	Connection              ownedConnectionSnapshot
	Settings                databaseSettings
	Target                  *contracts.DatabaseTarget
	Protocol                string
	PersistExecutionPlan    bool
	SessionConfig           *contracts.DatabaseSessionConfig
	UsesOverrideCredentials bool
	DatabaseName            string
	GatewayID               string
	InstanceID              string
}
