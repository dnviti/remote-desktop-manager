package tenants

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

type createTenantPayload struct {
	Name string `json:"name"`
}

type createdTenantResponse struct {
	ID        string    `json:"id"`
	Name      string    `json:"name"`
	Slug      string    `json:"slug"`
	UserCount int       `json:"userCount"`
	TeamCount int       `json:"teamCount"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s Service) HandleCreate(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload createTenantPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	tenant, err := s.CreateTenant(r.Context(), claims.UserID, payload.Name, requestIP(r))
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	if s.AuthService == nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, "auth service is not configured")
		return
	}

	login, err := s.AuthService.IssueBrowserTokensForUser(r.Context(), claims.UserID, requestIP(r), r.UserAgent())
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	csrfToken := s.AuthService.ApplyRefreshCookies(w, login.RefreshToken, login.RefreshExpires)
	app.WriteJSON(w, http.StatusCreated, map[string]any{
		"tenant":      tenant,
		"accessToken": login.AccessToken,
		"csrfToken":   csrfToken,
		"user":        login.User,
	})
}

func (s Service) CreateTenant(ctx context.Context, userID, name, ipAddress string) (createdTenantResponse, error) {
	if s.DB == nil {
		return createdTenantResponse{}, errors.New("postgres is not configured")
	}

	name = strings.TrimSpace(name)
	if len(name) < 2 || len(name) > 100 {
		return createdTenantResponse{}, &requestError{status: http.StatusBadRequest, message: "name must be between 2 and 100 characters"}
	}

	var existingUserID string
	if err := s.DB.QueryRow(ctx, `SELECT id FROM "User" WHERE id = $1`, userID).Scan(&existingUserID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return createdTenantResponse{}, &requestError{status: http.StatusNotFound, message: "User not found"}
		}
		return createdTenantResponse{}, err
	}

	slug, err := s.ensureUniqueSlug(ctx, generateSlug(name), "")
	if err != nil {
		return createdTenantResponse{}, err
	}
	tenantID := uuid.NewString()
	membershipID := uuid.NewString()

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return createdTenantResponse{}, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var created createdTenantResponse
	if err := tx.QueryRow(ctx, `
INSERT INTO "Tenant" (id, name, slug, "updatedAt")
VALUES ($1, $2, $3, NOW())
RETURNING id, name, slug, "createdAt", "updatedAt"
`, tenantID, name, slug).Scan(&created.ID, &created.Name, &created.Slug, &created.CreatedAt, &created.UpdatedAt); err != nil {
		return createdTenantResponse{}, err
	}

	if _, err := tx.Exec(ctx, `
UPDATE "TenantMember"
SET "isActive" = false
WHERE "userId" = $1 AND "isActive" = true
`, userID); err != nil {
		return createdTenantResponse{}, err
	}

	if _, err := tx.Exec(ctx, `
INSERT INTO "TenantMember" (id, "tenantId", "userId", role, status, "isActive", "updatedAt")
VALUES ($1, $2, $3, 'OWNER', 'ACCEPTED', true, NOW())
`, membershipID, created.ID, userID); err != nil {
		return createdTenantResponse{}, err
	}

	if err := insertTenantAuditLog(ctx, tx, userID, "TENANT_CREATE", "Tenant", created.ID, map[string]any{
		"name": created.Name,
	}, ipAddress); err != nil {
		return createdTenantResponse{}, err
	}

	if err := tx.Commit(ctx); err != nil {
		return createdTenantResponse{}, err
	}

	created.UserCount = 1
	created.TeamCount = 0

	if err := s.ensureTenantSSHKeyPair(ctx, created.ID); err != nil {
		// SSH key generation is best-effort and must not block tenant creation.
	}

	return created, nil
}
