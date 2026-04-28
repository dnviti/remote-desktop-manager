package recordingsapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type recordingVisibility struct {
	UserID     string
	TenantID   string
	Visibility *tenantauth.SessionVisibility
}

const recordingTenantScopeSQL = `COALESCE(sess."tenantId", team_scope."tenantId")`

func (s Service) resolveRecordingVisibility(ctx context.Context, claims authn.Claims) (recordingVisibility, error) {
	access := recordingVisibility{UserID: claims.UserID}
	if strings.TrimSpace(claims.TenantID) == "" {
		return access, nil
	}
	if s.TenantAuth == nil {
		return recordingVisibility{}, fmt.Errorf("tenant auth is unavailable")
	}
	visibility, err := s.TenantAuth.ResolveSessionVisibility(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return recordingVisibility{}, err
	}
	if visibility == nil {
		return recordingVisibility{}, &requestError{status: http.StatusForbidden, message: "Forbidden"}
	}
	access.TenantID = claims.TenantID
	access.Visibility = visibility
	return access, nil
}

func (v recordingVisibility) clauses(args *[]any, recordingAlias, tenantScopeSQL string) []string {
	conditions := make([]string, 0, 2)
	if v.TenantID != "" {
		tenantScopeSQL = strings.TrimSpace(tenantScopeSQL)
		if tenantScopeSQL == "" {
			tenantScopeSQL = `sess."tenantId"`
		}
		*args = append(*args, v.TenantID)
		tenantIndex := len(*args)
		*args = append(*args, v.UserID)
		userIndex := len(*args)
		conditions = append(conditions, fmt.Sprintf(`(%s = $%d OR (team_scope.id IS NULL AND %s."userId" = $%d))`, tenantScopeSQL, tenantIndex, recordingAlias, userIndex))
	}
	if v.TenantID == "" || (v.Visibility != nil && v.Visibility.RequiresOwnerFilter()) {
		*args = append(*args, v.UserID)
		conditions = append(conditions, fmt.Sprintf(`%s."userId" = $%d`, recordingAlias, len(*args)))
	}
	return conditions
}

func (v recordingVisibility) canDelete() bool {
	if v.TenantID == "" {
		return true
	}
	if v.Visibility == nil {
		return false
	}
	if v.Visibility.RequiresOwnerFilter() {
		return true
	}
	return v.Visibility.CanControl()
}

func joinConditions(conditions []string) string {
	if len(conditions) == 0 {
		return ""
	}
	result := conditions[0]
	for i := 1; i < len(conditions); i++ {
		result += " AND " + conditions[i]
	}
	return result
}
