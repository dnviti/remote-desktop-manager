package tabs

import (
	"context"
	"fmt"
	"net/http"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/connections"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxTabs = 50

type Service struct {
	DB          *pgxpool.Pool
	Connections connections.Service
}

type persistedTab struct {
	ID           string `json:"id"`
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
SELECT id, "connectionId", "sortOrder", "isActive"
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
		if err := rows.Scan(&item.ID, &item.ConnectionID, &item.SortOrder, &item.IsActive); err != nil {
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
	seenIDs := make(map[string]struct{}, len(capped))
	activeIndex := -1
	for index, tab := range capped {
		if tab.ID == "" || tab.ConnectionID == "" {
			continue
		}
		if _, exists := seenIDs[tab.ID]; exists {
			continue
		}
		if _, err := s.Connections.GetConnection(ctx, claims.UserID, claims.TenantID, tab.ConnectionID); err == nil {
			seenIDs[tab.ID] = struct{}{}
			validated = append(validated, persistedTab{
				ID:           tab.ID,
				ConnectionID: tab.ConnectionID,
				SortOrder:    index,
				IsActive:     false,
			})
			if tab.IsActive {
				activeIndex = len(validated) - 1
			}
		}
	}
	if activeIndex == -1 && len(validated) > 0 {
		activeIndex = len(validated) - 1
	}
	for index := range validated {
		validated[index].IsActive = index == activeIndex
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
`, tab.ID, claims.UserID, tab.ConnectionID, tab.SortOrder, tab.IsActive); err != nil {
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
