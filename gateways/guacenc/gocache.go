package main

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"log"
	"os"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/encoding"
	"google.golang.org/grpc/keepalive"
)

type jsonCodec struct{}

func (c *jsonCodec) Marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func (c *jsonCodec) Unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

func (c *jsonCodec) Name() string {
	return "proto"
}

type subscribeRequest struct {
	Channel string `json:"channel"`
	Pattern bool   `json:"pattern"`
}

type subscribeResponse struct {
	Channel string `json:"channel"`
	Message []byte `json:"message"`
}

type secretUpdate struct {
	Value   string `json:"value"`
	Version any    `json:"version"`
}

func init() {
	encoding.RegisterCodec(&jsonCodec{})
}

func startGocacheSubscriber(ctx context.Context, cfg config, tokens *tokenStore) {
	if cfg.cachePubSubURL == "" {
		log.Printf("CACHE_PUBSUB_URL not set; gocache subscriber disabled")
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
				log.Printf("gocache subscriber error: %v", err)
			}
			log.Printf("Reconnecting to gocache in %s...", retryDelay)

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
	conn, err := grpc.NewClient(
		cfg.cachePubSubURL,
		grpc.WithTransportCredentials(cacheTransportCredentials(cfg)),
		grpc.WithKeepaliveParams(keepalive.ClientParameters{
			Time:                30 * time.Second,
			Timeout:             10 * time.Second,
			PermitWithoutStream: true,
		}),
		grpc.WithDefaultCallOptions(grpc.ForceCodec(&jsonCodec{})),
	)
	if err != nil {
		return false, err
	}
	defer conn.Close()

	log.Printf("Connecting to gocache at %s for secret updates...", cfg.cachePubSubURL)

	stream, err := conn.NewStream(
		ctx,
		&grpc.StreamDesc{ServerStreams: true},
		"/cache.CacheService/Subscribe",
	)
	if err != nil {
		return false, err
	}

	req := &subscribeRequest{Channel: "system:secret:guacenc", Pattern: false}
	if err := stream.SendMsg(req); err != nil {
		return false, err
	}
	if err := stream.CloseSend(); err != nil {
		return false, err
	}

	log.Printf("Subscribed to gocache channel: %s", req.Channel)
	connected := true

	for {
		resp := new(subscribeResponse)
		if err := stream.RecvMsg(resp); err != nil {
			return connected, err
		}

		var update secretUpdate
		if err := json.Unmarshal(resp.Message, &update); err != nil {
			log.Printf("Malformed secret message (skipping): %v", err)
			continue
		}
		if update.Value == "" {
			continue
		}

		tokens.Set(update.Value)
		log.Printf("Auth token updated via gocache (version %v)", update.Version)
	}
}

func cacheTransportCredentials(cfg config) credentials.TransportCredentials {
	if cfg.cacheTLSCA == "" || cfg.cacheTLSCert == "" || cfg.cacheTLSKey == "" {
		return insecure.NewCredentials()
	}

	caData, err := os.ReadFile(cfg.cacheTLSCA)
	if err != nil {
		log.Printf("Failed to load gocache CA %s: %v", cfg.cacheTLSCA, err)
		return insecure.NewCredentials()
	}
	certData, err := os.ReadFile(cfg.cacheTLSCert)
	if err != nil {
		log.Printf("Failed to load gocache client cert %s: %v", cfg.cacheTLSCert, err)
		return insecure.NewCredentials()
	}
	keyData, err := os.ReadFile(cfg.cacheTLSKey)
	if err != nil {
		log.Printf("Failed to load gocache client key %s: %v", cfg.cacheTLSKey, err)
		return insecure.NewCredentials()
	}

	cert, err := tls.X509KeyPair(certData, keyData)
	if err != nil {
		log.Printf("Failed to parse gocache mTLS keypair: %v", err)
		return insecure.NewCredentials()
	}

	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(caData) {
		log.Printf("Failed to parse gocache CA bundle %s", cfg.cacheTLSCA)
		return insecure.NewCredentials()
	}

	return credentials.NewTLS(&tls.Config{
		MinVersion:   tls.VersionTLS12,
		RootCAs:      pool,
		Certificates: []tls.Certificate{cert},
	})
}

func isContextDone(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}
