package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
)

// ConnectSSH connects to an SSH target via the Arsenale SSH proxy.
func ConnectSSH(name string) {
	cfg := loadConfig()

	if err := ensureAuthenticated(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Find the connection
	conn, err := findConnectionByName(name, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if conn.Type != "SSH" {
		fmt.Fprintf(os.Stderr, "Error: connection '%s' is type %s, not SSH\n", name, conn.Type)
		os.Exit(1)
	}

	// Request proxy token
	body := map[string]string{
		"connectionId": conn.ID,
	}

	respBody, status, err := apiPost("/api/sessions/ssh-proxy/token", body, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if status != 200 {
		fmt.Fprintf(os.Stderr, "Error: failed to get SSH proxy token (HTTP %d): %s\n", status, string(respBody))
		os.Exit(1)
	}

	var tokenResp struct {
		Token                  string `json:"token"`
		ExpiresIn              int    `json:"expiresIn"`
		ConnectionInstructions struct {
			Command string `json:"command"`
			Port    int    `json:"port"`
			Host    string `json:"host"`
			Note    string `json:"note"`
		} `json:"connectionInstructions"`
	}
	if err := json.Unmarshal(respBody, &tokenResp); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to parse token response: %v\n", err)
		os.Exit(1)
	}

	// Write temporary SSH config
	tmpDir, err := os.MkdirTemp("", "arsenale-ssh-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(tmpDir)

	sshConfigPath := filepath.Join(tmpDir, "ssh_config")
	proxyHost := tokenResp.ConnectionInstructions.Host
	proxyPort := tokenResp.ConnectionInstructions.Port

	sshConfig := fmt.Sprintf(`Host arsenale-target
    HostName %s
    Port %d
    ProxyCommand echo '%s' | nc %s %d
    StrictHostKeyChecking no
    UserKnownHostsFile /dev/null
    LogLevel ERROR
`,
		conn.Host,
		conn.Port,
		tokenResp.Token,
		proxyHost,
		proxyPort,
	)

	if err := os.WriteFile(sshConfigPath, []byte(sshConfig), 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to write SSH config: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Connecting to %s (%s:%d) via Arsenale SSH proxy...\n", name, conn.Host, conn.Port)
	fmt.Printf("Proxy: %s:%d (token expires in %ds)\n\n", proxyHost, proxyPort, tokenResp.ExpiresIn)

	// Launch ssh
	sshArgs := []string{
		"-F", sshConfigPath,
		"arsenale-target",
	}

	sshCmd := exec.Command("ssh", sshArgs...)
	sshCmd.Stdin = os.Stdin
	sshCmd.Stdout = os.Stdout
	sshCmd.Stderr = os.Stderr

	// Handle signals for graceful cleanup
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGINT, syscall.SIGTERM)
	go func() {
		<-sigCh
		if sshCmd.Process != nil {
			sshCmd.Process.Signal(syscall.SIGTERM)
		}
	}()

	if err := sshCmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		fmt.Fprintf(os.Stderr, "Error: SSH client failed: %v\n", err)
		os.Exit(1)
	}
}

// ConnectRDP connects to an RDP target via the Arsenale RD Gateway.
func ConnectRDP(name string) {
	cfg := loadConfig()

	if err := ensureAuthenticated(cfg); err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	// Find the connection
	conn, err := findConnectionByName(name, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if conn.Type != "RDP" {
		fmt.Fprintf(os.Stderr, "Error: connection '%s' is type %s, not RDP\n", name, conn.Type)
		os.Exit(1)
	}

	// Download .rdp file from the RD Gateway endpoint
	respBody, status, err := apiGet(fmt.Sprintf("/api/rdgw/connections/%s/rdpfile", conn.ID), cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}

	if status == 401 {
		if err := refreshAccessToken(cfg); err != nil {
			fmt.Fprintf(os.Stderr, "Error: authentication expired. Run 'arsenale login' again.\n")
			os.Exit(1)
		}
		respBody, status, err = apiGet(fmt.Sprintf("/api/rdgw/connections/%s/rdpfile", conn.ID), cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error: %v\n", err)
			os.Exit(1)
		}
	}

	if status != 200 {
		fmt.Fprintf(os.Stderr, "Error: failed to get RDP file (HTTP %d): %s\n", status, string(respBody))
		os.Exit(1)
	}

	// Write .rdp file to temp location
	tmpDir, err := os.MkdirTemp("", "arsenale-rdp-*")
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: %v\n", err)
		os.Exit(1)
	}
	defer os.RemoveAll(tmpDir)

	safeName := sanitizeFilename(name)
	rdpFilePath := filepath.Join(tmpDir, safeName+".rdp")

	if err := os.WriteFile(rdpFilePath, respBody, 0600); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to write .rdp file: %v\n", err)
		os.Exit(1)
	}

	fmt.Printf("Connecting to %s (%s:%d) via RD Gateway...\n", name, conn.Host, conn.Port)
	fmt.Printf("RDP file: %s\n\n", rdpFilePath)

	// Launch the platform-specific RDP client
	var rdpCmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		rdpCmd = exec.Command("mstsc.exe", rdpFilePath)
	case "darwin":
		rdpCmd = exec.Command("open", rdpFilePath)
	default:
		// Try xfreerdp first (common on Linux), fall back to rdesktop
		if _, err := exec.LookPath("xfreerdp"); err == nil {
			rdpCmd = exec.Command("xfreerdp", rdpFilePath)
		} else if _, err := exec.LookPath("rdesktop"); err == nil {
			rdpCmd = exec.Command("rdesktop", "-r", "rdpfile:"+rdpFilePath)
		} else {
			fmt.Println("RDP file saved to:", rdpFilePath)
			fmt.Println("No RDP client found. Install xfreerdp or rdesktop, or open the file manually.")
			return
		}
	}

	rdpCmd.Stdin = os.Stdin
	rdpCmd.Stdout = os.Stdout
	rdpCmd.Stderr = os.Stderr

	if err := rdpCmd.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to launch RDP client: %v\n", err)
		fmt.Println("RDP file saved to:", rdpFilePath)
		os.Exit(1)
	}

	fmt.Println("RDP client launched. The connection file will be cleaned up when this process exits.")

	// Wait for the RDP client to finish
	if err := rdpCmd.Wait(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		// Some RDP clients exit with non-zero on disconnect, which is fine
	}
}

func sanitizeFilename(name string) string {
	result := make([]byte, 0, len(name))
	for _, c := range []byte(name) {
		if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' {
			result = append(result, c)
		} else {
			result = append(result, '_')
		}
	}
	return string(result)
}
