package tenantvaultapi

import (
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

type Service struct {
	DB        *pgxpool.Pool
	Redis     *redis.Client
	ServerKey []byte
	VaultTTL  time.Duration
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type encryptedField struct {
	Ciphertext string `json:"ciphertext"`
	IV         string `json:"iv"`
	Tag        string `json:"tag"`
}

type distributePayload struct {
	TargetUserID string `json:"targetUserId"`
}

type initResponse struct {
	Initialized bool `json:"initialized"`
}

type distributeResponse struct {
	Distributed bool `json:"distributed"`
	Pending     bool `json:"pending"`
}
