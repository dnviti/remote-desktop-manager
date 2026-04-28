package dbsessions

import (
	"encoding/json"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type createRequest struct {
	ConnectionID  string                           `json:"connectionId"`
	Username      string                           `json:"username,omitempty"`
	Password      string                           `json:"password,omitempty"`
	SessionConfig *contracts.DatabaseSessionConfig `json:"sessionConfig,omitempty"`
}

type databaseSettings struct {
	Protocol                 string                            `json:"protocol"`
	DatabaseName             string                            `json:"databaseName"`
	PersistExecutionPlan     bool                              `json:"persistExecutionPlan"`
	SSLMode                  string                            `json:"sslMode"`
	FirewallEnabled          *bool                             `json:"firewallEnabled,omitempty"`
	FirewallPolicyMode       string                            `json:"firewallPolicyMode,omitempty"`
	FirewallRules            []databaseFirewallRuleSettings    `json:"firewallRules,omitempty"`
	MaskingEnabled           *bool                             `json:"maskingEnabled,omitempty"`
	MaskingPolicyMode        string                            `json:"maskingPolicyMode,omitempty"`
	MaskingPolicies          []databaseMaskingPolicySettings   `json:"maskingPolicies,omitempty"`
	RateLimitEnabled         *bool                             `json:"rateLimitEnabled,omitempty"`
	RateLimitPolicyMode      string                            `json:"rateLimitPolicyMode,omitempty"`
	RateLimitPolicies        []databaseRateLimitPolicySettings `json:"rateLimitPolicies,omitempty"`
	AIQueryGenerationEnabled *bool                             `json:"aiQueryGenerationEnabled,omitempty"`
	AIQueryGenerationBackend string                            `json:"aiQueryGenerationBackend,omitempty"`
	AIQueryGenerationModel   string                            `json:"aiQueryGenerationModel,omitempty"`
	AIQueryOptimizerEnabled  *bool                             `json:"aiQueryOptimizerEnabled,omitempty"`
	AIQueryOptimizerBackend  string                            `json:"aiQueryOptimizerBackend,omitempty"`
	AIQueryOptimizerModel    string                            `json:"aiQueryOptimizerModel,omitempty"`
	OracleConnectionType     string                            `json:"oracleConnectionType"`
	OracleSID                string                            `json:"oracleSid"`
	OracleServiceName        string                            `json:"oracleServiceName"`
	OracleRole               string                            `json:"oracleRole"`
	OracleTNSAlias           string                            `json:"oracleTnsAlias"`
	OracleTNSDescriptor      string                            `json:"oracleTnsDescriptor"`
	OracleConnectString      string                            `json:"oracleConnectString"`
	MSSQLInstanceName        string                            `json:"mssqlInstanceName"`
	MSSQLAuthMode            string                            `json:"mssqlAuthMode"`
	DB2DatabaseAlias         string                            `json:"db2DatabaseAlias"`
}

type databaseFirewallRuleSettings struct {
	ID       string `json:"id,omitempty"`
	Name     string `json:"name"`
	Pattern  string `json:"pattern"`
	Action   string `json:"action"`
	Scope    string `json:"scope,omitempty"`
	Enabled  *bool  `json:"enabled,omitempty"`
	Priority int    `json:"priority,omitempty"`
}

type databaseMaskingPolicySettings struct {
	ID            string   `json:"id,omitempty"`
	Name          string   `json:"name"`
	ColumnPattern string   `json:"columnPattern"`
	Strategy      string   `json:"strategy"`
	ExemptRoles   []string `json:"exemptRoles,omitempty"`
	Scope         string   `json:"scope,omitempty"`
	Enabled       *bool    `json:"enabled,omitempty"`
}

type databaseRateLimitPolicySettings struct {
	ID          string   `json:"id,omitempty"`
	Name        string   `json:"name"`
	QueryType   string   `json:"queryType,omitempty"`
	WindowMS    int      `json:"windowMs,omitempty"`
	MaxQueries  int      `json:"maxQueries,omitempty"`
	BurstMax    int      `json:"burstMax,omitempty"`
	ExemptRoles []string `json:"exemptRoles,omitempty"`
	Scope       string   `json:"scope,omitempty"`
	Action      string   `json:"action,omitempty"`
	Enabled     *bool    `json:"enabled,omitempty"`
	Priority    int      `json:"priority,omitempty"`
}

type gatewaySnapshot struct {
	ID             string
	Type           string
	Host           string
	Port           int
	IsManaged      bool
	DeploymentMode string
	TunnelEnabled  bool
	LBStrategy     string
	EgressPolicy   json.RawMessage
}

type managedGatewayInstance struct {
	ID             string
	Host           string
	Port           int
	ActiveSessions int
	CreatedAt      time.Time
}

type databaseRoute struct {
	GatewayID       string
	InstanceID      string
	ProxyHost       string
	ProxyPort       int
	RoutingDecision *sessions.RoutingDecision
}
