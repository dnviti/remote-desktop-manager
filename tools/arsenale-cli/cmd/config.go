package cmd

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	"gopkg.in/yaml.v3"
)

// CLIConfig holds the Arsenale CLI configuration.
type CLIConfig struct {
	ServerURL    string `yaml:"server_url"`
	AccessToken  string `yaml:"access_token,omitempty"`
	RefreshToken string `yaml:"refresh_token,omitempty"`
	TokenExpiry  string `yaml:"token_expiry,omitempty"`
	CacheTTL     string `yaml:"cache_ttl,omitempty"`
}

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error: cannot determine home directory:", err)
		os.Exit(1)
	}
	return filepath.Join(home, ".arsenale")
}

func configPath() string {
	return filepath.Join(configDir(), "config.yaml")
}

func loadConfig() *CLIConfig {
	cfg := &CLIConfig{
		ServerURL: "http://localhost:3001",
		CacheTTL:  "5m",
	}

	data, err := os.ReadFile(configPath())
	if err != nil {
		return cfg
	}

	if err := yaml.Unmarshal(data, cfg); err != nil {
		fmt.Fprintln(os.Stderr, "Warning: failed to parse config file:", err)
	}

	return cfg
}

func saveConfig(cfg *CLIConfig) error {
	dir := configDir()
	if err := os.MkdirAll(dir, 0700); err != nil {
		return fmt.Errorf("create config dir: %w", err)
	}

	data, err := yaml.Marshal(cfg)
	if err != nil {
		return fmt.Errorf("marshal config: %w", err)
	}

	return os.WriteFile(configPath(), data, 0600)
}

func (c *CLIConfig) isTokenValid() bool {
	if c.AccessToken == "" || c.TokenExpiry == "" {
		return false
	}
	expiry, err := time.Parse(time.RFC3339, c.TokenExpiry)
	if err != nil {
		return false
	}
	// Add 30-second buffer
	return time.Now().Before(expiry.Add(-30 * time.Second))
}

// Config prints the current configuration.
func Config() {
	cfg := loadConfig()

	fmt.Println("Arsenale CLI Configuration")
	fmt.Println("==========================")
	fmt.Printf("Config file:   %s\n", configPath())
	fmt.Printf("Server URL:    %s\n", cfg.ServerURL)
	fmt.Printf("Cache TTL:     %s\n", cfg.CacheTTL)

	if cfg.AccessToken != "" {
		if cfg.isTokenValid() {
			fmt.Println("Auth status:   authenticated")
		} else {
			fmt.Println("Auth status:   token expired (run 'arsenale login')")
		}
	} else {
		fmt.Println("Auth status:   not authenticated (run 'arsenale login')")
	}
}
