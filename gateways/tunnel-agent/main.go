package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/signal"
	"syscall"
)

var version = "1.7.1"

func main() {
	healthcheck := flag.Bool("healthcheck", false, "exit 0 when the tunnel-agent binary is runnable")
	flag.Parse()
	if *healthcheck {
		return
	}

	cfg, dormant, err := LoadConfigFromEnv(version)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[tunnel-agent] %v\n", err)
		os.Exit(1)
	}
	if dormant {
		fmt.Fprintln(os.Stdout, "[tunnel-agent] Tunnel env vars not set - dormant mode, exiting")
		return
	}

	fmt.Fprintf(os.Stdout, "[tunnel-agent] Starting (gateway=%s, server=%s)\n", cfg.GatewayID, cfg.ServerURL)
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	agent := NewAgent(*cfg)
	if err := agent.Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		fmt.Fprintf(os.Stderr, "[tunnel-agent] ERROR %v\n", err)
		os.Exit(1)
	}
}
