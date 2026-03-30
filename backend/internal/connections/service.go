package connections

import (
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

var ErrLegacyConnectionFlow = errors.New("legacy connection flow required")

type Service struct {
	DB                  *pgxpool.Pool
	Redis               *redis.Client
	ServerEncryptionKey []byte
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type createPayload struct {
	Name                    string          `json:"name"`
	Type                    string          `json:"type"`
	Host                    string          `json:"host"`
	Port                    int             `json:"port"`
	Username                *string         `json:"username"`
	Password                *string         `json:"password"`
	Domain                  *string         `json:"domain"`
	CredentialSecretID      *string         `json:"credentialSecretId"`
	ExternalVaultProviderID *string         `json:"externalVaultProviderId"`
	ExternalVaultPath       *string         `json:"externalVaultPath"`
	Description             *string         `json:"description"`
	FolderID                *string         `json:"folderId"`
	TeamID                  *string         `json:"teamId"`
	EnableDrive             *bool           `json:"enableDrive"`
	GatewayID               *string         `json:"gatewayId"`
	SSHTerminalConfig       json.RawMessage `json:"sshTerminalConfig"`
	RDPSettings             json.RawMessage `json:"rdpSettings"`
	VNCSettings             json.RawMessage `json:"vncSettings"`
	DBSettings              json.RawMessage `json:"dbSettings"`
	DefaultCredentialMode   *string         `json:"defaultCredentialMode"`
	DLPPolicy               json.RawMessage `json:"dlpPolicy"`
	BastionConnectionID     *string         `json:"bastionConnectionId"`
	TargetDBHost            *string         `json:"targetDbHost"`
	TargetDBPort            *int            `json:"targetDbPort"`
	DBType                  *string         `json:"dbType"`
}

type ImportPayload struct {
	Name        string
	Type        string
	Host        string
	Port        int
	Username    string
	Password    string
	Domain      *string
	Description *string
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

type optionalJSON struct {
	Present bool
	Value   json.RawMessage
}

func (o *optionalJSON) UnmarshalJSON(data []byte) error {
	o.Present = true
	if string(data) == "null" {
		o.Value = nil
		return nil
	}
	o.Value = append(o.Value[:0], data...)
	return nil
}

type updatePayload struct {
	Name                    optionalString `json:"name"`
	Type                    optionalString `json:"type"`
	Host                    optionalString `json:"host"`
	Port                    optionalInt    `json:"port"`
	Username                optionalString `json:"username"`
	Password                optionalString `json:"password"`
	Domain                  optionalString `json:"domain"`
	CredentialSecretID      optionalString `json:"credentialSecretId"`
	ExternalVaultProviderID optionalString `json:"externalVaultProviderId"`
	ExternalVaultPath       optionalString `json:"externalVaultPath"`
	Description             optionalString `json:"description"`
	FolderID                optionalString `json:"folderId"`
	EnableDrive             optionalBool   `json:"enableDrive"`
	GatewayID               optionalString `json:"gatewayId"`
	SSHTerminalConfig       optionalJSON   `json:"sshTerminalConfig"`
	RDPSettings             optionalJSON   `json:"rdpSettings"`
	VNCSettings             optionalJSON   `json:"vncSettings"`
	DBSettings              optionalJSON   `json:"dbSettings"`
	DefaultCredentialMode   optionalString `json:"defaultCredentialMode"`
	DLPPolicy               optionalJSON   `json:"dlpPolicy"`
	BastionConnectionID     optionalString `json:"bastionConnectionId"`
	TargetDBHost            optionalString `json:"targetDbHost"`
	TargetDBPort            optionalInt    `json:"targetDbPort"`
	DBType                  optionalString `json:"dbType"`
}

type connectionResponse struct {
	ID                      string          `json:"id"`
	Name                    string          `json:"name"`
	Type                    string          `json:"type"`
	Host                    string          `json:"host"`
	Port                    int             `json:"port"`
	FolderID                *string         `json:"folderId"`
	TeamID                  *string         `json:"teamId"`
	TeamName                *string         `json:"teamName,omitempty"`
	TeamRole                *string         `json:"teamRole,omitempty"`
	Scope                   string          `json:"scope"`
	CredentialSecretID      *string         `json:"credentialSecretId"`
	CredentialSecretName    *string         `json:"credentialSecretName"`
	CredentialSecretType    *string         `json:"credentialSecretType"`
	ExternalVaultProviderID *string         `json:"externalVaultProviderId"`
	ExternalVaultPath       *string         `json:"externalVaultPath"`
	Description             *string         `json:"description"`
	IsFavorite              bool            `json:"isFavorite"`
	EnableDrive             bool            `json:"enableDrive"`
	GatewayID               *string         `json:"gatewayId"`
	SSHTerminalConfig       json.RawMessage `json:"sshTerminalConfig,omitempty"`
	RDPSettings             json.RawMessage `json:"rdpSettings,omitempty"`
	VNCSettings             json.RawMessage `json:"vncSettings,omitempty"`
	DBSettings              json.RawMessage `json:"dbSettings,omitempty"`
	DefaultCredentialMode   *string         `json:"defaultCredentialMode"`
	DLPPolicy               json.RawMessage `json:"dlpPolicy,omitempty"`
	TargetDBHost            *string         `json:"targetDbHost"`
	TargetDBPort            *int            `json:"targetDbPort"`
	DBType                  *string         `json:"dbType"`
	BastionConnectionID     *string         `json:"bastionConnectionId"`
	IsOwner                 bool            `json:"isOwner"`
	Permission              *string         `json:"permission,omitempty"`
	SharedBy                *string         `json:"sharedBy,omitempty"`
	CreatedAt               time.Time       `json:"createdAt"`
	UpdatedAt               time.Time       `json:"updatedAt"`
}

type listResponse struct {
	Own    []connectionResponse `json:"own"`
	Shared []connectionResponse `json:"shared"`
	Team   []connectionResponse `json:"team"`
}

type accessResult struct {
	Connection connectionResponse
	AccessType string
}

type rowScanner interface {
	Scan(dest ...any) error
}
