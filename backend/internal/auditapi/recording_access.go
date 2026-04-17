package auditapi

import (
	"context"
	"fmt"
	"net/http"
	"strings"

	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/tenantauth"
)

type sessionRecordingAccess struct {
	UserID     string
	TenantID   string
	Visibility *tenantauth.SessionVisibility
}

func (s Service) resolveSessionRecordingAccess(ctx context.Context, claims authn.Claims) (sessionRecordingAccess, error) {
	access := sessionRecordingAccess{UserID: claims.UserID}
	if strings.TrimSpace(claims.TenantID) == "" {
		return access, nil
	}
	visibility, err := s.TenantAuth.ResolveSessionVisibility(ctx, claims.UserID, claims.TenantID)
	if err != nil {
		return sessionRecordingAccess{}, err
	}
	if visibility == nil {
		return sessionRecordingAccess{}, &requestError{status: http.StatusForbidden, message: "Forbidden"}
	}
	access.TenantID = claims.TenantID
	access.Visibility = visibility
	return access, nil
}

func (a sessionRecordingAccess) clauses(args *[]any, recordingAlias, sessionAlias string) []string {
	conditions := make([]string, 0, 2)
	if a.TenantID != "" {
		*args = append(*args, a.TenantID)
		conditions = append(conditions, fmt.Sprintf(`%s."tenantId" = $%d`, sessionAlias, len(*args)))
	}
	if a.TenantID == "" || (a.Visibility != nil && a.Visibility.RequiresOwnerFilter()) {
		*args = append(*args, a.UserID)
		conditions = append(conditions, fmt.Sprintf(`%s."userId" = $%d`, recordingAlias, len(*args)))
	}
	return conditions
}

func joinRecordingAccessConditions(conditions []string) string {
	if len(conditions) == 0 {
		return ""
	}
	result := conditions[0]
	for i := 1; i < len(conditions); i++ {
		result += " AND " + conditions[i]
	}
	return result
}
