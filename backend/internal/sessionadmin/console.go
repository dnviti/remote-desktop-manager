package sessionadmin

import (
	"net/http"
	"strconv"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type sessionConsoleResponse struct {
	Scope    string                       `json:"scope"`
	Total    int                          `json:"total"`
	Sessions []sessions.SessionConsoleDTO `json:"sessions"`
}

func (s Service) HandleSessionConsole(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	visibility, ok := s.resolveSessionVisibility(w, r, claims)
	if !ok {
		return
	}

	query, err := parseSessionConsoleQuery(r)
	if err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	filter := sessions.SessionConsoleFilter{
		TenantID:      claims.TenantID,
		Protocol:      query.Protocol,
		Statuses:      query.Statuses,
		GatewayID:     query.GatewayID,
		Limit:         query.Limit,
		Offset:        query.Offset,
		IncludeClosed: true,
	}
	if visibility.Scope == tenantauth.SessionVisibilityScopeOwn {
		filter.UserID = claims.UserID
		filter.IncludeClosed = false
		filter.Statuses = filterNonClosedSessionStatuses(filter.Statuses)
	}

	items, err := s.Store.ListSessionConsoleSessions(r.Context(), filter)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	total, err := s.Store.CountSessionConsoleSessions(r.Context(), filter)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	app.WriteJSON(w, http.StatusOK, sessionConsoleResponse{
		Scope:    string(visibility.Scope),
		Total:    total,
		Sessions: items,
	})
}

type sessionConsoleQuery struct {
	Protocol  string
	Statuses  []string
	GatewayID string
	Limit     int
	Offset    int
}

func parseSessionConsoleQuery(r *http.Request) (sessionConsoleQuery, error) {
	query := sessionConsoleQuery{
		Protocol:  normalizeProtocol(r.URL.Query().Get("protocol")),
		Statuses:  normalizeSessionStatusFilters(r.URL.Query().Get("status")),
		GatewayID: strings.TrimSpace(r.URL.Query().Get("gatewayId")),
		Limit:     50,
		Offset:    0,
	}
	if value := strings.TrimSpace(r.URL.Query().Get("limit")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 1 || parsed > 200 {
			return sessionConsoleQuery{}, &statusQueryError{message: "limit must be between 1 and 200"}
		}
		query.Limit = parsed
	}
	if value := strings.TrimSpace(r.URL.Query().Get("offset")); value != "" {
		parsed, err := strconv.Atoi(value)
		if err != nil || parsed < 0 {
			return sessionConsoleQuery{}, &statusQueryError{message: "offset must be 0 or greater"}
		}
		query.Offset = parsed
	}
	if raw := strings.TrimSpace(r.URL.Query().Get("status")); raw != "" && len(query.Statuses) == 0 {
		return sessionConsoleQuery{}, &statusQueryError{message: "status must be a comma-separated list containing ACTIVE, IDLE, PAUSED, or CLOSED"}
	}
	return query, nil
}

type statusQueryError struct{ message string }

func (e *statusQueryError) Error() string { return e.message }

func normalizeSessionStatusFilters(value string) []string {
	parts := strings.Split(value, ",")
	statuses := make([]string, 0, len(parts))
	seen := make(map[string]struct{}, len(parts))
	for _, part := range parts {
		normalized := strings.ToUpper(strings.TrimSpace(part))
		switch normalized {
		case sessions.SessionStatusActive, sessions.SessionStatusIdle, sessions.SessionStatusPaused, sessions.SessionStatusClosed:
			if _, ok := seen[normalized]; ok {
				continue
			}
			seen[normalized] = struct{}{}
			statuses = append(statuses, normalized)
		}
	}
	return statuses
}

func filterNonClosedSessionStatuses(statuses []string) []string {
	filtered := make([]string, 0, len(statuses))
	for _, status := range statuses {
		if status != sessions.SessionStatusClosed {
			filtered = append(filtered, status)
		}
	}
	return filtered
}
