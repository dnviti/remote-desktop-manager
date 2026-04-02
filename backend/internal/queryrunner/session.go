package queryrunner

import (
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func buildSessionInitStatements(protocol string, config *contracts.DatabaseSessionConfig) []string {
	if config == nil {
		return nil
	}

	statements := make([]string, 0, 4+len(config.InitCommands))
	switch normalizeTargetProtocol(protocol) {
	case protocolPostgreSQL:
		if timezone := strings.TrimSpace(config.Timezone); timezone != "" {
			statements = append(statements, fmt.Sprintf("SET timezone TO '%s'", escapeSQLLiteral(timezone)))
		}
		if searchPath := strings.TrimSpace(config.SearchPath); searchPath != "" {
			statements = append(statements, fmt.Sprintf("SET search_path TO %s", searchPath))
		}
		if encoding := strings.TrimSpace(config.Encoding); encoding != "" {
			statements = append(statements, fmt.Sprintf("SET client_encoding TO '%s'", escapeSQLLiteral(encoding)))
		}
	case protocolMySQL:
		if timezone := strings.TrimSpace(config.Timezone); timezone != "" {
			statements = append(statements, fmt.Sprintf("SET time_zone = '%s'", escapeSQLLiteral(timezone)))
		}
		if encoding := strings.TrimSpace(config.Encoding); encoding != "" {
			statements = append(statements, fmt.Sprintf("SET NAMES '%s'", escapeSQLLiteral(encoding)))
		}
	case protocolOracle:
		if timezone := strings.TrimSpace(config.Timezone); timezone != "" {
			statements = append(statements, fmt.Sprintf("ALTER SESSION SET TIME_ZONE = '%s'", escapeSQLLiteral(timezone)))
		}
		if searchPath := strings.TrimSpace(config.SearchPath); searchPath != "" {
			statements = append(statements, fmt.Sprintf("ALTER SESSION SET CURRENT_SCHEMA = %s", escapeOracleIdentifier(searchPath)))
		}
	}
	for _, command := range config.InitCommands {
		command = strings.TrimSpace(command)
		if command == "" {
			continue
		}
		statements = append(statements, command)
	}
	return statements
}

func buildTargetSessionInitStatements(target *contracts.DatabaseTarget) []string {
	if target == nil || target.SessionConfig == nil {
		return nil
	}

	config := *target.SessionConfig
	if targetProtocol(target) == protocolOracle {
		config.SearchPath = oracleCurrentSchemaName(target, config.SearchPath)
	}
	return buildSessionInitStatements(target.Protocol, &config)
}

func oracleCurrentSchemaName(target *contracts.DatabaseTarget, searchPath string) string {
	searchPath = strings.TrimSpace(searchPath)
	if searchPath == "" {
		return ""
	}

	for _, reserved := range []string{
		target.Database,
		target.OracleServiceName,
		target.OracleSID,
		effectiveTargetDatabase(target),
	} {
		if reserved != "" && strings.EqualFold(searchPath, strings.TrimSpace(reserved)) {
			return ""
		}
	}

	return searchPath
}

func escapeSQLLiteral(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}

func escapeOracleIdentifier(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}
