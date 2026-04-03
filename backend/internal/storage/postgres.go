package storage

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

func OpenPostgres(ctx context.Context) (*pgxpool.Pool, error) {
	databaseURL, err := DatabaseURLFromEnv()
	if err != nil {
		return nil, err
	}
	if databaseURL == "" {
		return nil, nil
	}

	config, err := pgxpool.ParseConfig(augmentDatabaseURL(databaseURL, os.Getenv("DATABASE_SSL_ROOT_CERT")))
	if err != nil {
		return nil, fmt.Errorf("parse database url: %w", err)
	}

	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("open postgres pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}
	if err := RequireMigrations(ctx, pool); err != nil {
		pool.Close()
		return nil, err
	}

	return pool, nil
}

func DatabaseURLFromEnv() (string, error) {
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value, nil
	}

	secretPath := os.Getenv("DATABASE_URL_FILE")
	if secretPath == "" {
		return "", nil
	}

	payload, err := os.ReadFile(secretPath)
	if err != nil {
		return "", fmt.Errorf("read DATABASE_URL_FILE: %w", err)
	}

	return strings.TrimSpace(string(payload)), nil
}

func augmentDatabaseURL(rawURL, sslRootCert string) string {
	if sslRootCert == "" {
		return rawURL
	}

	parsed, err := url.Parse(rawURL)
	if err != nil {
		return rawURL
	}

	query := parsed.Query()
	if query.Get("sslrootcert") == "" {
		query.Set("sslrootcert", sslRootCert)
	}
	parsed.RawQuery = query.Encode()
	return parsed.String()
}
