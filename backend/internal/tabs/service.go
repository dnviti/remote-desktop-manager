package tabs

import (
	"context"
	"fmt"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxTabs = 50

type Service struct {
	DB          *pgxpool.Pool
	Connections connections.Service
}

type persistedTab struct {
	ConnectionID string `json:"connectionId"`
	SortOrder    int    `json:"sortOrder"`
	IsActive     bool   `json:"isActive"`
}

type syncPayload struct {
	Tabs []persistedTab `json:"tabs"`
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	result, err := s.GetTabs(r.Context(), claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleSync(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	var payload syncPayload
	if err := app.ReadJSON(r, &payload); err != nil {
		app.ErrorJSON(w, http.StatusBadRequest, err.Error())
		return
	}

	result, err := s.SyncTabs(r.Context(), claims, payload.Tabs)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleClear(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.ClearTabs(r.Context(), claims.UserID); err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"cleared": true})
}

func (s Service) GetTabs(ctx context.Context, userID string) ([]persistedTab, error) {
	rows, err := s.DB.Query(ctx, `
SELECT "connectionId", "sortOrder", "isActive"
FROM "OpenTab"
WHERE "userId" = $1
ORDER BY "sortOrder" ASC
`, userID)
	if err != nil {
		return nil, fmt.Errorf("list open tabs: %w", err)
	}
	defer rows.Close()

	result := make([]persistedTab, 0)
	for rows.Next() {
		var item persistedTab
		if err := rows.Scan(&item.ConnectionID, &item.SortOrder, &item.IsActive); err != nil {
			return nil, fmt.Errorf("scan open tab: %w", err)
		}
		result = append(result, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate open tabs: %w", err)
	}
	return result, nil
}

func (s Service) SyncTabs(ctx context.Context, claims authn.Claims, tabs []persistedTab) ([]persistedTab, error) {
	capped := tabs
	if len(capped) > maxTabs {
		capped = capped[:maxTabs]
	}

	validated := make([]persistedTab, 0, len(capped))
	for index, tab := range capped {
		if tab.ConnectionID == "" {
			continue
		}
		if _, err := s.Connections.GetConnection(ctx, claims.UserID, claims.TenantID, tab.ConnectionID); err == nil {
			validated = append(validated, persistedTab{
				ConnectionID: tab.ConnectionID,
				SortOrder:    index,
				IsActive:     tab.IsActive,
			})
		}
	}

	tx, err := s.DB.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin tab sync: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `DELETE FROM "OpenTab" WHERE "userId" = $1`, claims.UserID); err != nil {
		return nil, fmt.Errorf("clear open tabs: %w", err)
	}

	for _, tab := range validated {
		if _, err := tx.Exec(ctx, `
INSERT INTO "OpenTab" (id, "userId", "connectionId", "sortOrder", "isActive")
VALUES ($1, $2, $3, $4, $5)
`, uuid.NewString(), claims.UserID, tab.ConnectionID, tab.SortOrder, tab.IsActive); err != nil {
			return nil, fmt.Errorf("insert open tab: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit tab sync: %w", err)
	}
	return validated, nil
}

func (s Service) ClearTabs(ctx context.Context, userID string) error {
	if _, err := s.DB.Exec(ctx, `DELETE FROM "OpenTab" WHERE "userId" = $1`, userID); err != nil {
		return fmt.Errorf("clear open tabs: %w", err)
	}
	return nil
}
