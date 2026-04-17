package sessionadmin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/dnviti/arsenale/backend/internal/sessions"
	stream "github.com/dnviti/arsenale/backend/internal/sse"
)

const activeSessionStreamInterval = 5 * time.Second

type activeSessionSnapshot struct {
	ActiveSessions []sessions.ActiveSessionDTO `json:"activeSessions"`
	SessionCount   int                         `json:"sessionCount"`
}

func (s Service) HandleStream(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	visibility, ok := s.resolveSessionVisibility(w, r, claims)
	if !ok {
		return
	}

	filter := activeSessionFilterForVisibility(claims, visibility, normalizeProtocol(r.URL.Query().Get("protocol")), strings.TrimSpace(r.URL.Query().Get("gatewayId")))

	snapshot, err := s.buildStreamSnapshot(r.Context(), filter)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	sse, err := stream.Open(w)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := sse.Event("snapshot", snapshot); err != nil {
		return
	}

	ticker := time.NewTicker(activeSessionStreamInterval)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			snapshot, err := s.buildStreamSnapshot(r.Context(), filter)
			if err != nil {
				return
			}
			if err := sse.Event("snapshot", snapshot); err != nil {
				return
			}
		}
	}
}

func (s Service) buildStreamSnapshot(ctx context.Context, filter sessions.ActiveSessionFilter) (activeSessionSnapshot, error) {
	items, err := s.Store.ListActiveSessions(ctx, filter)
	if err != nil {
		return activeSessionSnapshot{}, err
	}
	count, err := s.Store.CountActiveSessions(ctx, filter)
	if err != nil {
		return activeSessionSnapshot{}, err
	}
	return activeSessionSnapshot{
		ActiveSessions: items,
		SessionCount:   count,
	}, nil
}
