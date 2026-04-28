package dbsessions

import (
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/sessions"
)

func validateWritableQueryAccess(queryType dbQueryType, tenantRole string, explainOnly bool) error {
	if queryType == dbQueryTypeSelect {
		return nil
	}

	switch strings.ToUpper(strings.TrimSpace(tenantRole)) {
	case "OPERATOR", "ADMIN", "OWNER":
		return nil
	}

	if explainOnly {
		return &requestError{status: http.StatusForbidden, message: "EXPLAIN for " + string(queryType) + " queries requires OPERATOR role or above"}
	}
	return &requestError{status: http.StatusForbidden, message: string(queryType) + " queries require OPERATOR role or above"}
}

func supportsStoredExecutionPlan(protocol string) bool {
	switch normalizeDatabaseProtocol(protocol) {
	case "postgresql", "mysql":
		return true
	default:
		return false
	}
}

func classifyQueryOperationError(err error) error {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return err
	}
	if errors.Is(err, ErrQueryRuntimeUnsupported) {
		return &requestError{status: http.StatusNotImplemented, message: "Database session runtime is unsupported for this session"}
	}

	lowered := strings.ToLower(err.Error())
	switch {
	case strings.Contains(lowered, "sql is required"),
		strings.Contains(lowered, "multiple sql statements"),
		strings.Contains(lowered, "invalid introspection type"),
		strings.Contains(lowered, "type is required"),
		strings.Contains(lowered, "target is required"),
		strings.Contains(lowered, "unsupported protocol"):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "authentication"),
		strings.Contains(lowered, "password"),
		strings.Contains(lowered, "permission denied"):
		return &requestError{status: http.StatusUnauthorized, message: err.Error()}
	case strings.Contains(lowered, "syntax error"),
		strings.Contains(lowered, "does not exist"),
		strings.Contains(lowered, "unknown column"),
		strings.Contains(lowered, "relation "):
		return &requestError{status: http.StatusBadRequest, message: err.Error()}
	case strings.Contains(lowered, "timeout"),
		strings.Contains(lowered, "timed out"):
		return &requestError{status: http.StatusGatewayTimeout, message: err.Error()}
	default:
		return &requestError{status: http.StatusBadGateway, message: err.Error()}
	}
}

func writeOwnedQueryError(w http.ResponseWriter, err error) {
	var reqErr *requestError
	switch {
	case errors.As(err, &reqErr):
		app.ErrorJSON(w, reqErr.status, reqErr.message)
	case errors.Is(err, ErrQueryRuntimeUnsupported):
		app.ErrorJSON(w, http.StatusNotImplemented, "Database session runtime is unsupported for this session")
	case errors.Is(err, sessions.ErrSessionNotFound):
		app.ErrorJSON(w, http.StatusNotFound, "session not found")
	case errors.Is(err, sessions.ErrSessionClosed):
		app.ErrorJSON(w, http.StatusGone, "session already closed")
	default:
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}

func queryMaxRows() int {
	const defaultMaxRows = 10000
	value := strings.TrimSpace(os.Getenv("DB_QUERY_MAX_ROWS"))
	if value == "" {
		return defaultMaxRows
	}
	parsed, err := strconv.Atoi(value)
	if err != nil || parsed <= 0 {
		return defaultMaxRows
	}
	return parsed
}
