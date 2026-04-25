package vaultapi

import (
	"context"
	"encoding/json"
	"net/http"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	stream "github.com/dnviti/arsenale/backend/internal/sse"
	"github.com/redis/go-redis/v9"
)

const vaultStatusStreamChannel = "vault:status"
const vaultStatusStreamInterval = 30 * time.Second

func (s Service) HandleStatusStream(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	s.handleStatusStream(w, r, claims.UserID, func(ctx context.Context) (statusResponse, error) {
		return s.GetStatus(ctx, claims.UserID)
	})
}

func (s Service) handleStatusStream(
	w http.ResponseWriter,
	r *http.Request,
	userID string,
	loadStatus func(context.Context) (statusResponse, error),
) {
	statusMessages, closeStatusMessages := s.subscribeVaultStatus(r.Context())
	defer closeStatusMessages()

	status, err := loadStatus(r.Context())
	if err != nil {
		s.writeError(w, err)
		return
	}

	sse, err := stream.Open(w)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if err := sse.Event("snapshot", status); err != nil {
		return
	}

	ticker := time.NewTicker(vaultStatusStreamInterval)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case message, ok := <-statusMessages:
			if !ok {
				statusMessages = nil
				continue
			}
			if !vaultStatusUpdateMatchesUser(message.Payload, userID) {
				continue
			}
			status, err := loadStatus(r.Context())
			if err != nil {
				return
			}
			if err := sse.Event("snapshot", status); err != nil {
				return
			}
		case <-ticker.C:
			status, err := loadStatus(r.Context())
			if err != nil {
				return
			}
			if err := sse.Event("snapshot", status); err != nil {
				return
			}
		}
	}
}

func (s Service) subscribeVaultStatus(ctx context.Context) (<-chan *redis.Message, func()) {
	if s.Redis == nil {
		return nil, func() {}
	}

	pubsub := s.Redis.Subscribe(ctx, vaultStatusStreamChannel)
	if _, err := pubsub.Receive(ctx); err != nil {
		_ = pubsub.Close()
		return nil, func() {}
	}

	return pubsub.Channel(), func() {
		_ = pubsub.Close()
	}
}

func vaultStatusUpdateMatchesUser(payload string, userID string) bool {
	var update struct {
		UserID string `json:"userId"`
	}
	if err := json.Unmarshal([]byte(payload), &update); err != nil {
		return false
	}
	return update.UserID == userID
}
