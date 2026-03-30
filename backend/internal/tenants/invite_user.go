package tenants

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type inviteUserPayload struct {
	Email     string  `json:"email"`
	Role      string  `json:"role"`
	ExpiresAt *string `json:"expiresAt"`
}

type invitedTenantUserResponse struct {
	UserID   string  `json:"userId"`
	Email    string  `json:"email"`
	Username *string `json:"username,omitempty"`
	Role     string  `json:"role"`
	Status   string  `json:"status"`
}

func (s Service) HandleInviteUser(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := requireOwnTenant(claims, r.PathValue("id")); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}
	if err := s.requireManageUsersPermission(r.Context(), claims); err != nil {
		app.ErrorJSON(w, err.status, err.message)
		return
	}

	var payload inviteUserPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.InviteUser(r.Context(), claims.UserID, claims.TenantID, payload)
	if err != nil {
		var reqErr *requestError
		if errorsAsRequestError(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusCreated, result)
}

func (s Service) InviteUser(ctx context.Context, actingUserID, tenantID string, payload inviteUserPayload) (invitedTenantUserResponse, error) {
	if s.DB == nil {
		return invitedTenantUserResponse{}, fmt.Errorf("database is unavailable")
	}

	email := strings.TrimSpace(strings.ToLower(payload.Email))
	if !looksLikeEmail(email) {
		return invitedTenantUserResponse{}, &requestError{status: http.StatusBadRequest, message: "email must be a valid email"}
	}

	role := strings.ToUpper(strings.TrimSpace(payload.Role))
	switch role {
	case "ADMIN", "OPERATOR", "MEMBER", "CONSULTANT", "AUDITOR", "GUEST":
	default:
		return invitedTenantUserResponse{}, &requestError{status: http.StatusBadRequest, message: "role must be one of ADMIN, OPERATOR, MEMBER, CONSULTANT, AUDITOR, GUEST"}
	}

	var expiresAt *time.Time
	if payload.ExpiresAt != nil && strings.TrimSpace(*payload.ExpiresAt) != "" {
		parsed, err := time.Parse(time.RFC3339, strings.TrimSpace(*payload.ExpiresAt))
		if err != nil {
			return invitedTenantUserResponse{}, &requestError{status: http.StatusBadRequest, message: "expiresAt must be a valid ISO-8601 date-time"}
		}
		expiresAt = &parsed
	}

	var (
		targetUserID string
		username     *string
		usernameRaw  sql.NullString
	)
	if err := s.DB.QueryRow(ctx, `SELECT id, username FROM "User" WHERE email = $1`, email).Scan(&targetUserID, &usernameRaw); err != nil {
		if err == pgx.ErrNoRows {
			return invitedTenantUserResponse{}, &requestError{status: http.StatusNotFound, message: "User not found. They must register first."}
		}
		return invitedTenantUserResponse{}, fmt.Errorf("load invited user: %w", err)
	}
	if usernameRaw.Valid {
		username = &usernameRaw.String
	}

	var existingID string
	err := s.DB.QueryRow(ctx, `SELECT id FROM "TenantMember" WHERE "tenantId" = $1 AND "userId" = $2`, tenantID, targetUserID).Scan(&existingID)
	switch {
	case err == nil:
		return invitedTenantUserResponse{}, &requestError{status: http.StatusBadRequest, message: "User is already a member of this organization"}
	case err != nil && err != pgx.ErrNoRows:
		return invitedTenantUserResponse{}, fmt.Errorf("check existing tenant membership: %w", err)
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return invitedTenantUserResponse{}, fmt.Errorf("begin invite user: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
INSERT INTO "TenantMember" (id, "tenantId", "userId", role, status, "isActive", "joinedAt", "expiresAt", "updatedAt")
VALUES ($1, $2, $3, $4::"TenantRole", 'PENDING', false, NOW(), $5, NOW())
`, uuid.NewString(), tenantID, targetUserID, role, expiresAt); err != nil {
		return invitedTenantUserResponse{}, fmt.Errorf("insert tenant invite membership: %w", err)
	}

	detailsJSON := fmt.Sprintf(`{"invitedEmail":%q,"role":%q}`, email, role)
	if _, err := tx.Exec(ctx, `
INSERT INTO "AuditLog" (id, "userId", action, "targetType", "targetId", details)
VALUES ($1, $2, 'TENANT_INVITE_USER'::"AuditAction", 'Tenant', $3, $4::jsonb)
`, uuid.NewString(), actingUserID, tenantID, detailsJSON); err != nil {
		return invitedTenantUserResponse{}, fmt.Errorf("insert tenant invite audit log: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return invitedTenantUserResponse{}, fmt.Errorf("commit invite user: %w", err)
	}

	return invitedTenantUserResponse{
		UserID:   targetUserID,
		Email:    email,
		Username: username,
		Role:     role,
		Status:   "PENDING",
	}, nil
}
