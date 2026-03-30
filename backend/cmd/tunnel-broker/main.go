package main

import (
	"context"
	"log/slog"
	"net/http"
	"os"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/catalog"
	"github.com/dnviti/arsenale/backend/internal/storage"
	"github.com/dnviti/arsenale/backend/internal/tunnelbroker"
	"github.com/dnviti/arsenale/backend/pkg/contracts"
)

func main() {
	ctx := context.Background()

	db, err := storage.OpenPostgres(ctx)
	if err != nil {
		panic(err)
	}
	if db != nil {
		defer db.Close()
	}

	key, err := tunnelbroker.LoadServerEncryptionKey()
	if err != nil {
		panic(err)
	}

	logger := slog.New(slog.NewTextHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	broker := tunnelbroker.NewBroker(tunnelbroker.BrokerConfig{
		Store:              tunnelbroker.NewPostgresStore(db),
		Logger:             logger,
		ServerEncryptionKey: key,
		SpiffeTrustDomain:  getenv("SPIFFE_TRUST_DOMAIN", "arsenale.local"),
		ProxyBindHost:      getenv("TUNNEL_TCP_PROXY_BIND_HOST", "0.0.0.0"),
		ProxyAdvertiseHost: getenv("TUNNEL_TCP_PROXY_ADVERTISE_HOST", "tunnel-broker-go"),
	})

	service := app.StaticService{
		Descriptor: catalog.MustService(contracts.ServiceTunnelBroker),
		Register: func(mux *http.ServeMux) {
			broker.RegisterRoutes(mux)
		},
	}
	if err := app.Run(context.Background(), service); err != nil {
		panic(err)
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
