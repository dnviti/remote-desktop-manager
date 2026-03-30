package main

import (
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func parseExpiry(raw string) time.Duration {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return 0
	}
	if value, err := time.ParseDuration(raw); err == nil {
		return value
	}
	if len(raw) < 2 {
		return 0
	}
	unit := raw[len(raw)-1]
	number := raw[:len(raw)-1]
	parsed := parseInt(number, 0)
	switch unit {
	case 'd':
		return time.Duration(parsed) * 24 * time.Hour
	case 'h':
		return time.Duration(parsed) * time.Hour
	case 'm':
		return time.Duration(parsed) * time.Minute
	case 's':
		return time.Duration(parsed) * time.Second
	default:
		return 0
	}
}

func parseInt(raw string, fallback int) int {
	parsed, err := strconv.Atoi(strings.TrimSpace(raw))
	if err != nil {
		return fallback
	}
	return parsed
}

func loadOptionalSecret(envKey, fileEnvKey string) (string, error) {
	if value := strings.TrimSpace(os.Getenv(envKey)); value != "" {
		return value, nil
	}
	filePath := strings.TrimSpace(os.Getenv(fileEnvKey))
	if filePath == "" {
		return "", nil
	}
	payload, err := os.ReadFile(filePath)
	if err != nil {
		return "", fmt.Errorf("read %s: %w", fileEnvKey, err)
	}
	return strings.TrimSpace(string(payload)), nil
}
