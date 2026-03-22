package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"text/tabwriter"
)

// Connection represents a lightweight connection listing.
type Connection struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Host string `json:"host"`
	Port int    `json:"port"`
}

// List displays all available connections.
func List() {
	cfg := loadConfig()

	if err := ensureAuthenticated(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	respBody, status, err := apiGet("/api/cli/connections", cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if status == 401 {
		// Try refresh
		if err := refreshAccessToken(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: authentication expired. Run 'arsenale login' again.\n")
			os.Exit(1)
		}
		respBody, status, err = apiGet("/api/cli/connections", cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	}

	if status != 200 {
		fmt.Fprintf(os.Stderr, "Error: server returned HTTP %d: %s\n", status, string(respBody))
		os.Exit(1)
	}

	var connections []Connection
	if err := json.Unmarshal(respBody, &connections); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to parse connections: %v\n", err)
		os.Exit(1)
	}

	if len(connections) == 0 {
		fmt.Println("No connections found.")
		return
	}

	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(w, "NAME\tTYPE\tHOST\tPORT")
	fmt.Fprintln(w, "----\t----\t----\t----")
	for _, c := range connections {
		fmt.Fprintf(w, "%s\t%s\t%s\t%d\n", c.Name, c.Type, c.Host, c.Port)
	}
	w.Flush()

	fmt.Printf("\n%d connection(s) total\n", len(connections))
}

// findConnectionByName looks up a connection by name and returns it.
func findConnectionByName(name string, cfg *CLIConfig) (*Connection, error) {
	respBody, status, err := apiGet("/api/cli/connections", cfg)
	if err != nil {
		return nil, fmt.Errorf("fetch connections: %w", err)
	}

	if status == 401 {
		if err := refreshAccessToken(cfg); err != nil {
			return nil, fmt.Errorf("authentication expired: %w", err)
		}
		respBody, status, err = apiGet("/api/cli/connections", cfg)
		if err != nil {
			return nil, fmt.Errorf("fetch connections after refresh: %w", err)
		}
	}

	if status != 200 {
		return nil, fmt.Errorf("server returned HTTP %d: %s", status, string(respBody))
	}

	var connections []Connection
	if err := json.Unmarshal(respBody, &connections); err != nil {
		return nil, fmt.Errorf("parse connections: %w", err)
	}

	for _, c := range connections {
		if c.Name == name {
			return &c, nil
		}
	}

	return nil, fmt.Errorf("connection '%s' not found. Run 'arsenale list' to see available connections", name)
}
