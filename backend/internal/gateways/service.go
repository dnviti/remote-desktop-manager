package gateways

import (
	"encoding/json"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	ServerEncryptionKey []byte
	DefaultGRPCPort     int
}

type gatewayResponse struct {
	ID                       string     `json:"id"`
	Name                     string     `json:"name"`
	Type                     string     `json:"type"`
	Host                     string     `json:"host"`
	Port                     int        `json:"port"`
	Description              *string    `json:"description"`
	IsDefault                bool       `json:"isDefault"`
	HasSSHKey                bool       `json:"hasSshKey"`
	APIPort                  *int       `json:"apiPort"`
	InactivityTimeoutSeconds int        `json:"inactivityTimeoutSeconds"`
	TenantID                 string     `json:"tenantId"`
	CreatedByID              string     `json:"createdById"`
	CreatedAt                time.Time  `json:"createdAt"`
	UpdatedAt                time.Time  `json:"updatedAt"`
	MonitoringEnabled        bool       `json:"monitoringEnabled"`
	MonitorIntervalMS        int        `json:"monitorIntervalMs"`
	LastHealthStatus         string     `json:"lastHealthStatus"`
	LastCheckedAt            *time.Time `json:"lastCheckedAt"`
	LastLatencyMS            *int       `json:"lastLatencyMs"`
	LastError                *string    `json:"lastError"`
	IsManaged                bool       `json:"isManaged"`
	PublishPorts             bool       `json:"publishPorts"`
	LBStrategy               string     `json:"lbStrategy"`
	DesiredReplicas          int        `json:"desiredReplicas"`
	AutoScale                bool       `json:"autoScale"`
	MinReplicas              int        `json:"minReplicas"`
	MaxReplicas              int        `json:"maxReplicas"`
	SessionsPerInstance      int        `json:"sessionsPerInstance"`
	ScaleDownCooldownSeconds int        `json:"scaleDownCooldownSeconds"`
	LastScaleAction          *time.Time `json:"lastScaleAction"`
	TemplateID               *string    `json:"templateId"`
	TotalInstances           int        `json:"totalInstances"`
	RunningInstances         int        `json:"runningInstances"`
	TunnelEnabled            bool       `json:"tunnelEnabled"`
	TunnelConnected          bool       `json:"tunnelConnected"`
	TunnelConnectedAt        *time.Time `json:"tunnelConnectedAt"`
	TunnelClientCertExp      *time.Time `json:"tunnelClientCertExp"`
}

type gatewayRecord struct {
	ID                       string
	Name                     string
	Type                     string
	Host                     string
	Port                     int
	Description              *string
	IsDefault                bool
	EncryptedUsername        *string
	UsernameIV               *string
	UsernameTag              *string
	EncryptedPassword        *string
	PasswordIV               *string
	PasswordTag              *string
	EncryptedSSHKey          *string
	SSHKeyIV                 *string
	SSHKeyTag                *string
	APIPort                  *int
	InactivityTimeoutSeconds int
	TenantID                 string
	CreatedByID              string
	CreatedAt                time.Time
	UpdatedAt                time.Time
	MonitoringEnabled        bool
	MonitorIntervalMS        int
	LastHealthStatus         string
	LastCheckedAt            *time.Time
	LastLatencyMS            *int
	LastError                *string
	IsManaged                bool
	PublishPorts             bool
	LBStrategy               string
	DesiredReplicas          int
	AutoScale                bool
	MinReplicas              int
	MaxReplicas              int
	SessionsPerInstance      int
	ScaleDownCooldownSeconds int
	LastScaleAction          *time.Time
	TemplateID               *string
	TunnelEnabled            bool
	TunnelConnected          bool
	TunnelConnectedAt        *time.Time
	TunnelClientCertExp      *time.Time
	TotalInstances           int
	RunningInstances         int
}

type createPayload struct {
	Name                     string  `json:"name"`
	Type                     string  `json:"type"`
	Host                     string  `json:"host"`
	Port                     int     `json:"port"`
	Description              *string `json:"description"`
	IsDefault                *bool   `json:"isDefault"`
	Username                 *string `json:"username"`
	Password                 *string `json:"password"`
	SSHPrivateKey            *string `json:"sshPrivateKey"`
	APIPort                  *int    `json:"apiPort"`
	PublishPorts             *bool   `json:"publishPorts"`
	LBStrategy               *string `json:"lbStrategy"`
	MonitoringEnabled        *bool   `json:"monitoringEnabled"`
	MonitorIntervalMS        *int    `json:"monitorIntervalMs"`
	InactivityTimeoutSeconds *int    `json:"inactivityTimeoutSeconds"`
}

type optionalString struct {
	Present bool
	Value   *string
}

func (o *optionalString) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value string
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type optionalInt struct {
	Present bool
	Value   *int
}

func (o *optionalInt) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value int
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type optionalBool struct {
	Present bool
	Value   *bool
}

func (o *optionalBool) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	var value bool
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	o.Value = &value
	return nil
}

type updatePayload struct {
	Name                     optionalString `json:"name"`
	Host                     optionalString `json:"host"`
	Port                     optionalInt    `json:"port"`
	Description              optionalString `json:"description"`
	IsDefault                optionalBool   `json:"isDefault"`
	Username                 optionalString `json:"username"`
	Password                 optionalString `json:"password"`
	SSHPrivateKey            optionalString `json:"sshPrivateKey"`
	APIPort                  optionalInt    `json:"apiPort"`
	PublishPorts             optionalBool   `json:"publishPorts"`
	LBStrategy               optionalString `json:"lbStrategy"`
	MonitoringEnabled        optionalBool   `json:"monitoringEnabled"`
	MonitorIntervalMS        optionalInt    `json:"monitorIntervalMs"`
	InactivityTimeoutSeconds optionalInt    `json:"inactivityTimeoutSeconds"`
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type connectivityResult struct {
	Reachable bool    `json:"reachable"`
	LatencyMS *int    `json:"latencyMs"`
	Error     *string `json:"error"`
}
