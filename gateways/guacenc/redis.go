package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

type secretUpdate struct {
	Value   string `json:"value"`
	Version any    `json:"version"`
}

func startSecretSubscriber(ctx context.Context, cfg config, tokens *tokenStore) {
	if strings.TrimSpace(cfg.redisURL) == "" {
		log.Printf("REDIS_URL not set; secret subscriber disabled")
		return
	}

	go func() {
		retryDelay := time.Second
		const maxRetryDelay = 60 * time.Second

		for {
			connected, err := subscribeOnce(ctx, cfg, tokens)
			if ctx.Err() != nil {
				return
			}
			if connected {
				retryDelay = time.Second
			}
			if err != nil {
				log.Printf("secret subscriber error: %v", err)
			}
			log.Printf("Reconnecting to Redis in %s...", retryDelay)

			select {
			case <-ctx.Done():
				return
			case <-time.After(retryDelay):
			}

			if retryDelay < maxRetryDelay {
				retryDelay *= 2
				if retryDelay > maxRetryDelay {
					retryDelay = maxRetryDelay
				}
			}
		}
	}()
}

func subscribeOnce(ctx context.Context, cfg config, tokens *tokenStore) (bool, error) {
	client, err := newRedisClient(cfg)
	if err != nil {
		return false, err
	}
	defer client.Close()

	log.Printf("Connecting to Redis at %s for secret updates...", cfg.redisURL)

	pubsub := client.Subscribe(ctx, "system:secret:guacenc")
	defer pubsub.Close()

	if _, err := pubsub.Receive(ctx); err != nil {
		return false, err
	}

	log.Printf("Subscribed to Redis channel: system:secret:guacenc")
	connected := true

	for {
		msg, err := pubsub.ReceiveMessage(ctx)
		if err != nil {
			return connected, err
		}

		payload, err := decodeSecretMessage(msg.Payload)
		if err != nil {
			log.Printf("Malformed secret message (skipping): %v", err)
			continue
		}
		if payload.Value == "" {
			continue
		}

		tokens.Set(payload.Value)
		log.Printf("Auth token updated via Redis (version %v)", payload.Version)
	}
}

func decodeSecretMessage(message string) (secretUpdate, error) {
	decoded := []byte(message)
	// The server publishes JSON payloads directly to Redis now.
	var update secretUpdate
	if err := json.Unmarshal(decoded, &update); err != nil {
		return secretUpdate{}, err
	}
	return update, nil
}

func newRedisClient(cfg config) (*redis.Client, error) {
	opts, err := redis.ParseURL(cfg.redisURL)
	if err != nil {
		return nil, err
	}

	if cfg.redisTLSEnabled || strings.HasPrefix(strings.ToLower(cfg.redisURL), "rediss://") {
		tlsConfig, err := redisTLSConfig(cfg)
		if err != nil {
			return nil, err
		}
		opts.TLSConfig = tlsConfig
	}

	return redis.NewClient(opts), nil
}

func redisTLSConfig(cfg config) (*tls.Config, error) {
	tlsConfig := &tls.Config{MinVersion: tls.VersionTLS12}

	if cfg.redisTLSCA != "" {
		caData, err := os.ReadFile(cfg.redisTLSCA)
		if err != nil {
			return nil, err
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(caData) {
			return nil, os.ErrInvalid
		}
		tlsConfig.RootCAs = pool
	}

	if cfg.redisTLSCert != "" && cfg.redisTLSKey != "" {
		certData, err := os.ReadFile(cfg.redisTLSCert)
		if err != nil {
			return nil, err
		}
		keyData, err := os.ReadFile(cfg.redisTLSKey)
		if err != nil {
			return nil, err
		}
		cert, err := tls.X509KeyPair(certData, keyData)
		if err != nil {
			return nil, err
		}
		tlsConfig.Certificates = []tls.Certificate{cert}
	}

	return tlsConfig, nil
}
