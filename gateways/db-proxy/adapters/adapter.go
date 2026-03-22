// Package adapters defines the common interface and types for database protocol
// adapters used by the Arsenale DB proxy gateway.
//
// Each adapter implements a specific database wire protocol (PostgreSQL, MySQL,
// MongoDB, Oracle TNS, MSSQL TDS, IBM DB2 DRDA) and integrates with the
// vault credential injection and audit logging infrastructure.
package adapters

import (
	"context"
	"net"
)

// ConnectOptions holds the parameters for establishing a proxied database connection.
type ConnectOptions struct {
	SessionID    string
	Host         string
	Port         int
	Username     string
	Password     string
	DatabaseName string
	// Extra holds protocol-specific parameters:
	//   Oracle:  "sid", "serviceName"
	//   MSSQL:   "instanceName", "authMode" ("sql" | "windows")
	//   DB2:     "databaseAlias"
	Extra map[string]string
}

// SessionHandle is returned after a successful Connect and contains metadata
// about the established proxy session.
type SessionHandle struct {
	SessionID string
	Protocol  string
	LocalAddr string
}

// Adapter is the interface that all database protocol adapters must implement.
// Each adapter handles protocol-specific connection negotiation, authentication,
// and bidirectional data forwarding.
type Adapter interface {
	// Protocol returns the adapter's protocol identifier (e.g., "oracle", "mssql", "db2").
	Protocol() string

	// DefaultPort returns the default TCP port for this database protocol.
	DefaultPort() int

	// HealthCheck verifies the adapter is operational and can accept connections.
	HealthCheck() error

	// Connect establishes a connection to the target database server using the
	// provided options, performing protocol-level handshake and authentication.
	Connect(ctx context.Context, opts ConnectOptions) (*SessionHandle, error)

	// Forward starts bidirectional data forwarding between the client connection
	// and the upstream database connection for the specified session.
	Forward(ctx context.Context, sessionID string, client net.Conn) error

	// Disconnect tears down the proxy session and releases all resources.
	Disconnect(sessionID string)

	// ActiveSessions returns the number of currently active sessions.
	ActiveSessions() int
}

// Registry maps protocol names to their adapter implementations.
type Registry struct {
	adapters map[string]Adapter
}

// NewRegistry creates a new adapter registry pre-populated with all available
// protocol adapters.
func NewRegistry() *Registry {
	r := &Registry{
		adapters: make(map[string]Adapter),
	}

	// Register enterprise protocol adapters
	oracle := NewOracleAdapter()
	mssql := NewMSSQLAdapter()
	db2 := NewDB2Adapter()

	r.adapters[oracle.Protocol()] = oracle
	r.adapters[mssql.Protocol()] = mssql
	r.adapters[db2.Protocol()] = db2

	return r
}

// Get returns the adapter for the given protocol name, or nil if not found.
func (r *Registry) Get(protocol string) Adapter {
	return r.adapters[protocol]
}

// Protocols returns a list of all registered protocol names.
func (r *Registry) Protocols() []string {
	names := make([]string, 0, len(r.adapters))
	for name := range r.adapters {
		names = append(names, name)
	}
	return names
}

// HealthCheckAll runs health checks on all registered adapters and returns
// a map of protocol name to error (nil if healthy).
func (r *Registry) HealthCheckAll() map[string]error {
	results := make(map[string]error, len(r.adapters))
	for name, adapter := range r.adapters {
		results[name] = adapter.HealthCheck()
	}
	return results
}
