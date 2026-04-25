package vaultapi

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/redis/go-redis/v9"
)

func TestHandleTouchExtendsUnlockedVaultTTL(t *testing.T) {
	t.Parallel()

	svc, redisServer := newVaultTouchTestService(t)
	ctx := context.Background()
	if err := svc.Redis.Set(ctx, "vault:user:user-1", []byte(`{"ciphertext":"a","iv":"b","tag":"c"}`), time.Minute).Err(); err != nil {
		t.Fatalf("Set(vault:user) error = %v", err)
	}
	if err := svc.Redis.Set(ctx, "vault:tenant:tenant-1:user-1", []byte(`cached-tenant-key`), time.Minute).Err(); err != nil {
		t.Fatalf("Set(vault:tenant) error = %v", err)
	}

	req := httptest.NewRequest(http.MethodPost, "/api/vault/touch", nil)
	rec := httptest.NewRecorder()
	svc.HandleTouch(rec, req, authn.Claims{UserID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleTouch() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if ttl := redisServer.TTL("vault:user:user-1"); ttl < 25*time.Minute {
		t.Fatalf("vault:user TTL = %s, want >= 25m", ttl)
	}
	if ttl := redisServer.TTL("vault:tenant:tenant-1:user-1"); ttl < 25*time.Minute {
		t.Fatalf("vault:tenant TTL = %s, want >= 25m", ttl)
	}
	if body := rec.Body.String(); body != "{\"unlocked\":true}\n" {
		t.Fatalf("HandleTouch() body = %q", body)
	}
}

func TestHandleTouchLeavesLockedVaultUnchanged(t *testing.T) {
	t.Parallel()

	svc, _ := newVaultTouchTestService(t)
	req := httptest.NewRequest(http.MethodPost, "/api/vault/touch", nil)
	rec := httptest.NewRecorder()
	svc.HandleTouch(rec, req, authn.Claims{UserID: "user-1"})

	if rec.Code != http.StatusOK {
		t.Fatalf("HandleTouch() status = %d, want %d", rec.Code, http.StatusOK)
	}
	if body := rec.Body.String(); body != "{\"unlocked\":false}\n" {
		t.Fatalf("HandleTouch() body = %q", body)
	}
	if exists := svc.hasRedisKey(context.Background(), "vault:user:user-1"); exists {
		t.Fatal("expected locked vault touch to avoid creating a session")
	}
}

func TestTouchVaultSessionPublishesLockedStatusWhenSessionMissing(t *testing.T) {
	t.Parallel()

	svc, _ := newVaultTouchTestService(t)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	pubsub := svc.Redis.Subscribe(ctx, "vault:status")
	defer func() { _ = pubsub.Close() }()
	if _, err := pubsub.Receive(ctx); err != nil {
		t.Fatalf("pubsub.Receive() error = %v", err)
	}

	unlocked, err := svc.TouchVaultSession(ctx, "user-1")
	if err != nil {
		t.Fatalf("TouchVaultSession() error = %v", err)
	}
	if unlocked {
		t.Fatal("TouchVaultSession() unlocked = true, want false")
	}

	message, err := pubsub.ReceiveMessage(ctx)
	if err != nil {
		t.Fatalf("pubsub.ReceiveMessage() error = %v", err)
	}

	var payload struct {
		UserID   string `json:"userId"`
		Unlocked bool   `json:"unlocked"`
	}
	if err := json.Unmarshal([]byte(message.Payload), &payload); err != nil {
		t.Fatalf("json.Unmarshal(message.Payload) error = %v", err)
	}
	if payload.UserID != "user-1" {
		t.Fatalf("published userId = %q, want user-1", payload.UserID)
	}
	if payload.Unlocked {
		t.Fatalf("published unlocked = %v, want false", payload.Unlocked)
	}
}

func newVaultTouchTestService(t *testing.T) (Service, *miniredis.Miniredis) {
	t.Helper()

	server, err := miniredis.Run()
	if err != nil {
		t.Fatalf("miniredis.Run() error = %v", err)
	}
	t.Cleanup(server.Close)

	client := redis.NewClient(&redis.Options{Addr: server.Addr()})
	t.Cleanup(func() { _ = client.Close() })

	return Service{Redis: client, VaultTTL: 30 * time.Minute}, server
}
