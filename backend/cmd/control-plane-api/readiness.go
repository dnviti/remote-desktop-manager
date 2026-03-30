package main

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

type readinessResult struct {
	Status string          `json:"status"`
	Checks readinessChecks `json:"checks"`
}

type readinessChecks struct {
	Database      healthCheck `json:"database"`
	DesktopBroker healthCheck `json:"desktopBroker"`
	LegacyAPI     healthCheck `json:"legacyApi"`
}

type healthCheck struct {
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Error     string `json:"error,omitempty"`
}

func checkAPIReadiness(ctx context.Context, db *pgxpool.Pool, probe *legacyAPIProbe) readinessResult {
	database := checkDatabase(ctx, db)
	desktopBroker := checkHTTPService(ctx, getenv("DESKTOP_BROKER_HEALTH_URL", "http://desktop-broker-go:8091/healthz"))
	legacy := checkLegacyAPI(ctx, probe)

	status := "ok"
	if !database.OK || !desktopBroker.OK {
		status = "unavailable"
	}

	return readinessResult{
		Status: status,
		Checks: readinessChecks{
			Database:      database,
			DesktopBroker: desktopBroker,
			LegacyAPI:     legacy,
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

func checkLegacyAPI(ctx context.Context, probe *legacyAPIProbe) healthCheck {
	start := time.Now()
	if probe == nil || probe.client == nil || probe.url == "" {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: "legacy API probe not configured"}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, probe.url, nil)
	if err != nil {
		return healthCheck{OK: false, LatencyMs: time.Since(start).Milliseconds(), Error: err.Error()}
	}
	req.Host = getenv("LEGACY_NODE_API_HOST_HEADER", "localhost")
	resp, err := probe.client.Do(req)
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
