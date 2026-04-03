package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/dnviti/arsenale/backend/internal/runtimefeatures"
	"github.com/jackc/pgx/v5/pgxpool"
)

type readinessResult struct {
	Status string          `json:"status"`
	Checks readinessChecks `json:"checks"`
}

type readinessChecks struct {
	Database      healthCheck `json:"database"`
	DesktopBroker healthCheck `json:"desktopBroker"`
}

type healthCheck struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

func checkAPIReadiness(ctx context.Context, db *pgxpool.Pool, features runtimefeatures.Manifest) readinessResult {
	database := checkDatabase(ctx, db)
	desktopBroker := healthCheck{OK: true}
	if features.ConnectionsEnabled {
		desktopBroker = checkHTTPService(ctx, getenv("DESKTOP_BROKER_HEALTH_URL", "http://desktop-broker:8091/healthz"))
	}

	status := "ok"
	if !database.OK || !desktopBroker.OK {
		status = "unavailable"
	}

	return readinessResult{
		Status: status,
		Checks: readinessChecks{
			Database:      database,
			DesktopBroker: desktopBroker,
		},
	}
}

func checkDatabase(ctx context.Context, db *pgxpool.Pool) healthCheck {
	start := time.Now()
	if db == nil {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: "database not configured"}
	}

	checkCtx, cancel := context.WithTimeout(ctx, 3*time.Second)
	defer cancel()
	if err := db.Ping(checkCtx); err != nil {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}
	return healthCheck{OK: true, LatencyMs: time.Since(start).Milliseconds()}
}

func checkHTTPService(ctx context.Context, rawURL string) healthCheck {
	start := time.Now()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}

	client := &http.Client{Timeout: 5 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return healthCheck{
			OK:        false,
			LatencyMs: time.Since(start).Milliseconds(),
			Error:     fmt.Sprintf("unexpected status %d", resp.StatusCode),
		}
	}
	return healthCheck{OK: true, LatencyMs: time.Since(start).Milliseconds()}
}
