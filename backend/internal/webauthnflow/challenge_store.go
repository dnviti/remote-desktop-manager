package webauthnflow

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"time"

	"github.com/redis/go-redis/v9"
)

type storedChallenge struct {
	Challenge string `json:"challenge"`
}

func randomBytes(size int) ([]byte, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return nil, fmt.Errorf("generate random bytes: %w", err)
	}
	return value, nil
}

func challengeKey(userID string) string {
	return "webauthn:challenge:user:" + userID
}

func (s Service) NewChallenge() (string, error) {
	return randomBase64URL(32)
}

func (s Service) NewUserHandle() (string, error) {
	return randomBase64URL(32)
}

func (s Service) StoreChallenge(ctx context.Context, userID, challenge string) error {
	if s.Redis == nil {
		return nil
	}
	raw, err := json.Marshal(storedChallenge{Challenge: challenge})
	if err != nil {
		return fmt.Errorf("marshal webauthn challenge: %w", err)
	}
	if err := s.Redis.Set(ctx, challengeKey(userID), raw, ChallengeTTLSeconds*time.Second).Err(); err != nil {
		return fmt.Errorf("store webauthn challenge: %w", err)
	}
	return nil
}

func (s Service) TakeChallenge(ctx context.Context, userID string) (string, error) {
	if s.Redis == nil {
		return "", nil
	}
	value, err := s.Redis.GetDel(ctx, challengeKey(userID)).Bytes()
	switch {
	case err == nil:
		return decodeChallengePayload(value)
	case err == redis.Nil:
		return "", nil
	default:
		return "", fmt.Errorf("load webauthn challenge: %w", err)
	}
}

func decodeChallengePayload(value []byte) (string, error) {
	if len(value) == 0 {
		return "", nil
	}

	var payload storedChallenge
	if err := json.Unmarshal(value, &payload); err == nil && payload.Challenge != "" {
		return payload.Challenge, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(string(value))
	if err != nil {
		return "", fmt.Errorf("decode webauthn challenge payload: %w", err)
	}
	if err := json.Unmarshal(decoded, &payload); err != nil {
		return "", fmt.Errorf("decode webauthn challenge json: %w", err)
	}
	return payload.Challenge, nil
}
