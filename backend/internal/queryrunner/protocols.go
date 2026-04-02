package queryrunner

import (
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

const (
	protocolPostgreSQL = "postgresql"
	protocolMySQL      = "mysql"
	protocolMSSQL      = "mssql"
	protocolOracle     = "oracle"
	protocolMongoDB    = "mongodb"
)

func normalizeTargetProtocol(protocol string) string {
	switch strings.ToLower(strings.TrimSpace(protocol)) {
	case "", "postgres", "postgresql":
		return protocolPostgreSQL
	case "mysql", "mariadb":
		return protocolMySQL
	case "mssql", "sqlserver":
		return protocolMSSQL
	case "oracle":
		return protocolOracle
	case "mongodb", "mongo":
		return protocolMongoDB
	default:
		return strings.ToLower(strings.TrimSpace(protocol))
	}
}

func targetProtocol(target *contracts.DatabaseTarget) string {
	if target == nil {
		return protocolPostgreSQL
	}
	return normalizeTargetProtocol(target.Protocol)
}

func isPostgresTarget(target *contracts.DatabaseTarget) bool {
	return targetProtocol(target) == protocolPostgreSQL
}

func isSQLProtocol(protocol string) bool {
	switch normalizeTargetProtocol(protocol) {
	case protocolPostgreSQL, protocolMySQL, protocolMSSQL, protocolOracle:
		return true
	default:
		return false
	}
}
