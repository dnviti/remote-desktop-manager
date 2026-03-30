package webauthnflow

import (
	"encoding/base64"
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
)

const ChallengeTTLSeconds = 60

type Service struct {
	Redis  *redis.Client
	RPID   string
	RPName string
}

func New(redisClient *redis.Client) Service {
	return Service{
		Redis:  redisClient,
		RPID:   getenv("WEBAUTHN_RP_ID", "localhost"),
		RPName: getenv("WEBAUTHN_RP_NAME", "Arsenale"),
	}
}

func randomBase64URL(size int) (string, error) {
	raw, err := randomBytes(size)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

func getenv(key, fallback string) string {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	return value
}
