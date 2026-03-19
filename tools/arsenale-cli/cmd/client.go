package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

var httpClient = &http.Client{
	Timeout: 30 * time.Second,
}

// apiRequest makes an authenticated API request.
func apiRequest(method, path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	var bodyReader io.Reader
	if body != nil {
		data, err := json.Marshal(body)
		if err != nil {
			return nil, 0, fmt.Errorf("marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(data)
	}

	url := cfg.ServerURL + path
	req, err := http.NewRequest(method, url, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "arsenale-cli/1.7.0")

	if cfg.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	}

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("send request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read response: %w", err)
	}

	return respBody, resp.StatusCode, nil
}

// apiGet makes an authenticated GET request.
func apiGet(path string, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("GET", path, nil, cfg)
}

// apiPost makes an authenticated POST request.
func apiPost(path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("POST", path, body, cfg)
}

// refreshAccessToken attempts to refresh the access token using the refresh token.
func refreshAccessToken(cfg *CLIConfig) error {
	body := map[string]string{
		"refreshToken": cfg.RefreshToken,
	}

	respBody, status, err := apiPost("/api/auth/refresh", body, cfg)
	if err != nil {
		return fmt.Errorf("refresh token request failed: %w", err)
	}

	if status != 200 {
		return fmt.Errorf("refresh token failed (HTTP %d): %s", status, string(respBody))
	}

	var result struct {
		AccessToken  string `json:"accessToken"`
		RefreshToken string `json:"refreshToken"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return fmt.Errorf("parse refresh response: %w", err)
	}

	cfg.AccessToken = result.AccessToken
	if result.RefreshToken != "" {
		cfg.RefreshToken = result.RefreshToken
	}
	cfg.TokenExpiry = time.Now().Add(14 * time.Minute).Format(time.RFC3339) // ~15 min token life

	if err := saveConfig(cfg); err != nil {
		return fmt.Errorf("save refreshed config: %w", err)
	}

	return nil
}

// ensureAuthenticated ensures we have a valid access token.
func ensureAuthenticated(cfg *CLIConfig) error {
	if cfg.AccessToken == "" {
		return fmt.Errorf("not authenticated. Run 'arsenale login' first")
	}

	if !cfg.isTokenValid() {
		if cfg.RefreshToken == "" {
			return fmt.Errorf("token expired and no refresh token available. Run 'arsenale login' again")
		}
		fmt.Println("Access token expired, refreshing...")
		if err := refreshAccessToken(cfg); err != nil {
			return fmt.Errorf("failed to refresh token: %w. Run 'arsenale login' again", err)
		}
	}

	return nil
}
