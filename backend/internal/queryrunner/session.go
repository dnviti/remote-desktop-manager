package queryrunner

import (
	"fmt"
	"strings"

	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func buildSessionInitStatements(config *contracts.DatabaseSessionConfig) []string {
	if config == nil {
		return nil
	}

	statements := make([]string, 0, 3+len(config.InitCommands))
	if timezone := strings.TrimSpace(config.Timezone); timezone != "" {
		statements = append(statements, fmt.Sprintf("SET timezone TO '%s'", escapeSQLLiteral(timezone)))
	}
	if searchPath := strings.TrimSpace(config.SearchPath); searchPath != "" {
		statements = append(statements, fmt.Sprintf("SET search_path TO %s", searchPath))
	}
	if encoding := strings.TrimSpace(config.Encoding); encoding != "" {
		statements = append(statements, fmt.Sprintf("SET client_encoding TO '%s'", escapeSQLLiteral(encoding)))
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

func escapeSQLLiteral(value string) string {
	return strings.ReplaceAll(value, "'", "''")
}
