package main

import (
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	logger := newAgentLogger(os.Stdout, os.Stderr)
	cfg, dormant, err := loadConfig()
	if err != nil {
		logger.err("%v", err)
		os.Exit(1)
	}
	if dormant {
		logger.log("Tunnel env vars not set - dormant mode, exiting")
		return
	}

	logger.log("Starting (gateway=%s, server=%s)", cfg.GatewayID, cfg.ServerURL)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	agent := newTunnelAgent(cfg, logger)
	if err := agent.Run(ctx); err != nil {
		_, _ = fmt.Fprintf(os.Stderr, "[tunnel-agent] ERROR %v\n", err)
		os.Exit(1)
	}
}
