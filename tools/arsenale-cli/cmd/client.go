package cmd

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"time"
)

// Version is set by main.go.
var Version = "0.0.0"

var httpClient = &http.Client{
	Timeout: 90 * time.Second,
}

type tokenRefresher func(*CLIConfig) error

type APIClient struct {
	Config  *CLIConfig
	Refresh tokenRefresher
}

func newAPIClient(cfg *CLIConfig) APIClient {
	return APIClient{
		Config:  cfg,
		Refresh: refreshAccessToken,
	}
}

func (c APIClient) Request(method, path string, body interface{}) ([]byte, int, error) {
	respBody, status, err := c.Do(method, path, body)
	if err != nil {
		return nil, 0, err
	}

	if status == 401 && c.Config.RefreshToken != "" && c.Refresh != nil {
		if refreshErr := c.Refresh(c.Config); refreshErr == nil {
			return c.Do(method, path, body)
		}
	}

	return respBody, status, nil
}

func (c APIClient) RequestWithParams(method, path string, params url.Values, body interface{}) ([]byte, int, error) {
	if len(params) > 0 {
		path = path + "?" + params.Encode()
	}
	return c.Request(method, path, body)
}

func (c APIClient) Do(method, path string, body interface{}) ([]byte, int, error) {
	return doRequestWithConfig(method, path, body, c.Config)
}

// apiRequest makes an authenticated API request with automatic 401 retry.
func apiRequest(method, path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return newAPIClient(cfg).Request(method, path, body)
}

// apiRequestWithParams makes a request with URL query parameters.
func apiRequestWithParams(method, path string, params url.Values, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return newAPIClient(cfg).RequestWithParams(method, path, params, body)
}

// doRequest performs the actual HTTP request without retry logic.
func doRequest(method, path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return newAPIClient(cfg).Do(method, path, body)
}

func doRequestWithConfig(method, path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	var bodyReader io.Reader
	if body != nil {
		switch v := body.(type) {
		case []byte:
			bodyReader = bytes.NewReader(v)
		default:
			data, err := json.Marshal(body)
			if err != nil {
				return nil, 0, fmt.Errorf("marshal request body: %w", err)
			}
			bodyReader = bytes.NewReader(data)
		}
	}

	reqURL := cfg.ServerURL + path
	req, err := http.NewRequest(method, reqURL, bodyReader)
	if err != nil {
		return nil, 0, fmt.Errorf("create request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "arsenale-cli/"+Version)

	if cfg.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	}

	client, err := httpClientForConfig(cfg)
	if err != nil {
		return nil, 0, err
	}

	resp, err := client.Do(req)
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

// apiPut makes an authenticated PUT request.
func apiPut(path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("PUT", path, body, cfg)
}

// apiDelete makes an authenticated DELETE request.
func apiDelete(path string, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("DELETE", path, nil, cfg)
}

// apiDeleteWithBody makes an authenticated DELETE request with a body.
func apiDeleteWithBody(path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("DELETE", path, body, cfg)
}

// apiPatch makes an authenticated PATCH request.
func apiPatch(path string, body interface{}, cfg *CLIConfig) ([]byte, int, error) {
	return apiRequest("PATCH", path, body, cfg)
}

// apiUpload uploads a file via multipart form POST.
func apiUpload(path, filePath string, cfg *CLIConfig) ([]byte, int, error) {
	return apiUploadWithFields(path, filePath, nil, cfg)
}

func apiUploadWithFields(path, filePath string, fields map[string]string, cfg *CLIConfig) ([]byte, int, error) {
	file, err := os.Open(filePath)
	if err != nil {
		return nil, 0, fmt.Errorf("open file: %w", err)
	}
	defer file.Close()

	var buf bytes.Buffer
	writer := multipart.NewWriter(&buf)
	part, err := writer.CreateFormFile("file", filepath.Base(filePath))
	if err != nil {
		return nil, 0, fmt.Errorf("create form file: %w", err)
	}
	if _, err := io.Copy(part, file); err != nil {
		return nil, 0, fmt.Errorf("copy file data: %w", err)
	}
	for key, value := range fields {
		if err := writer.WriteField(key, value); err != nil {
			return nil, 0, fmt.Errorf("write multipart field %s: %w", key, err)
		}
	}
	writer.Close()

	reqURL := cfg.ServerURL + path
	req, err := http.NewRequest("POST", reqURL, &buf)
	if err != nil {
		return nil, 0, fmt.Errorf("create upload request: %w", err)
	}

	req.Header.Set("Content-Type", writer.FormDataContentType())
	req.Header.Set("User-Agent", "arsenale-cli/"+Version)
	if cfg.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	}

	client, err := httpClientForConfig(cfg)
	if err != nil {
		return nil, 0, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("upload request: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, resp.StatusCode, fmt.Errorf("read upload response: %w", err)
	}

	return respBody, resp.StatusCode, nil
}

// apiDownload downloads a file from the API and saves it to destPath.
func apiDownload(path, destPath string, cfg *CLIConfig) (int, error) {
	reqURL := cfg.ServerURL + path
	req, err := http.NewRequest("GET", reqURL, nil)
	if err != nil {
		return 0, fmt.Errorf("create download request: %w", err)
	}

	req.Header.Set("User-Agent", "arsenale-cli/"+Version)
	if cfg.AccessToken != "" {
		req.Header.Set("Authorization", "Bearer "+cfg.AccessToken)
	}

	client, err := httpClientForConfig(cfg)
	if err != nil {
		return 0, err
	}

	resp, err := client.Do(req)
	if err != nil {
		return 0, fmt.Errorf("download request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != 200 {
		body, _ := io.ReadAll(resp.Body)
		return resp.StatusCode, fmt.Errorf("download failed (HTTP %d): %s", resp.StatusCode, string(body))
	}

	out, err := os.Create(destPath)
	if err != nil {
		return resp.StatusCode, fmt.Errorf("create output file: %w", err)
	}
	defer out.Close()

	if _, err := io.Copy(out, resp.Body); err != nil {
		return resp.StatusCode, fmt.Errorf("write output file: %w", err)
	}

	return resp.StatusCode, nil
}

// refreshAccessToken attempts to refresh the access token using the refresh token.
func refreshAccessToken(cfg *CLIConfig) error {
	body := map[string]string{
		"refreshToken": cfg.RefreshToken,
	}

	respBody, status, err := doRequest("POST", "/api/auth/refresh", body, cfg)
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
	cfg.TokenExpiry = time.Now().Add(14 * time.Minute).Format(time.RFC3339)

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
		fmt.Fprintln(os.Stderr, "Access token expired, refreshing...")
		if err := refreshAccessToken(cfg); err != nil {
			return fmt.Errorf("failed to refresh token: %w. Run 'arsenale login' again", err)
		}
	}

	return nil
}
