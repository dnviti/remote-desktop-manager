package contracts

import "encoding/json"

type DatabaseTarget struct {
	Protocol      string                 `json:"protocol,omitempty"`
	Host          string                 `json:"host,omitempty"`
	Port          int                    `json:"port,omitempty"`
	Database      string                 `json:"database,omitempty"`
	SSLMode       string                 `json:"sslMode,omitempty"`
	Username      string                 `json:"username,omitempty"`
	Password      string                 `json:"password,omitempty"`
	SessionConfig *DatabaseSessionConfig `json:"sessionConfig,omitempty"`
}

type DatabaseSessionConfig struct {
	ActiveDatabase string   `json:"activeDatabase,omitempty"`
	Timezone       string   `json:"timezone,omitempty"`
	SearchPath     string   `json:"searchPath,omitempty"`
	Encoding       string   `json:"encoding,omitempty"`
	InitCommands   []string `json:"initCommands,omitempty"`
}

type QueryExecutionRequest struct {
	SQL     string          `json:"sql"`
	MaxRows int             `json:"maxRows,omitempty"`
	Target  *DatabaseTarget `json:"target,omitempty"`
}

type QueryExecutionResponse struct {
	Columns    []string         `json:"columns"`
	Rows       []map[string]any `json:"rows"`
	RowCount   int              `json:"rowCount"`
	Truncated  bool             `json:"truncated,omitempty"`
	DurationMs int64            `json:"durationMs"`
}

type QueryPlanRequest struct {
	SQL    string          `json:"sql"`
	Target *DatabaseTarget `json:"target,omitempty"`
}

type QueryPlanResponse struct {
	Supported bool   `json:"supported"`
	Plan      any    `json:"plan,omitempty"`
	Format    string `json:"format,omitempty"`
	Raw       string `json:"raw,omitempty"`
}

type QueryIntrospectionRequest struct {
	Type   string          `json:"type"`
	Target string          `json:"target,omitempty"`
	DB     *DatabaseTarget `json:"db,omitempty"`
}

type QueryIntrospectionResponse struct {
	Supported bool `json:"supported"`
	Data      any  `json:"data,omitempty"`
}

type SchemaFetchRequest struct {
	Target *DatabaseTarget `json:"target,omitempty"`
}

type SchemaInfo struct {
	Tables     []SchemaTable     `json:"tables"`
	Views      []SchemaView      `json:"views"`
	Functions  []SchemaRoutine   `json:"functions"`
	Procedures []SchemaRoutine   `json:"procedures"`
	Triggers   []SchemaTrigger   `json:"triggers"`
	Sequences  []SchemaSequence  `json:"sequences"`
	Packages   []SchemaPackage   `json:"packages"`
	Types      []SchemaNamedType `json:"types"`
}

type SchemaTable struct {
	Name    string         `json:"name"`
	Schema  string         `json:"schema"`
	Columns []SchemaColumn `json:"columns"`
}

type SchemaColumn struct {
	Name         string `json:"name"`
	DataType     string `json:"dataType"`
	Nullable     bool   `json:"nullable"`
	IsPrimaryKey bool   `json:"isPrimaryKey"`
}

type SchemaView struct {
	Name         string `json:"name"`
	Schema       string `json:"schema"`
	Materialized bool   `json:"materialized,omitempty"`
}

type SchemaRoutine struct {
	Name       string `json:"name"`
	Schema     string `json:"schema"`
	ReturnType string `json:"returnType,omitempty"`
}

type SchemaTrigger struct {
	Name      string `json:"name"`
	Schema    string `json:"schema"`
	TableName string `json:"tableName"`
	Event     string `json:"event"`
	Timing    string `json:"timing"`
}

type SchemaSequence struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
}

type SchemaPackage struct {
	Name    string `json:"name"`
	Schema  string `json:"schema"`
	HasBody bool   `json:"hasBody"`
}

type SchemaNamedType struct {
	Name   string `json:"name"`
	Schema string `json:"schema"`
	Kind   string `json:"kind"`
}

type ToolCallExecuteRequest struct {
	Capability string          `json:"capability"`
	Authz      AuthzRequest    `json:"authz"`
	Input      json.RawMessage `json:"input,omitempty"`
}

type ToolCallExecuteResponse struct {
	Capability CapabilityDefinition `json:"capability"`
	Decision   AuthzDecision        `json:"decision"`
	Output     any                  `json:"output,omitempty"`
	DryRun     bool                 `json:"dryRun"`
}
