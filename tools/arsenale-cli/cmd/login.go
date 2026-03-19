package cmd

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"runtime"
	"time"
)

// Login performs the OAuth 2.0 Device Authorization Grant flow.
func Login() {
	cfg := loadConfig()

	// Allow overriding server URL via flag or env
	if url := os.Getenv("ARSENALE_SERVER"); url != "" {
		cfg.ServerURL = url
	}

	// Check for --server flag
	for i, arg := range os.Args {
		if (arg == "--server" || arg == "-s") && i+1 < len(os.Args) {
			cfg.ServerURL = os.Args[i+1]
			break
		}
	}

	fmt.Printf("Authenticating with %s ...\n\n", cfg.ServerURL)

	// Step 1: Initiate device authorization
	respBody, status, err := apiPost("/api/cli/auth/device", nil, cfg)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to initiate device authorization: %v\n", err)
		os.Exit(1)
	}
	if status != 200 {
		fmt.Fprintf(os.Stderr, "Error: server returned HTTP %d: %s\n", status, string(respBody))
		os.Exit(1)
	}

	var deviceResp struct {
		DeviceCode              string `json:"device_code"`
		UserCode                string `json:"user_code"`
		VerificationURI         string `json:"verification_uri"`
		VerificationURIComplete string `json:"verification_uri_complete"`
		ExpiresIn               int    `json:"expires_in"`
		Interval                int    `json:"interval"`
	}
	if err := json.Unmarshal(respBody, &deviceResp); err != nil {
		fmt.Fprintf(os.Stderr, "Error: failed to parse device auth response: %v\n", err)
		os.Exit(1)
	}

	fmt.Println("To authenticate, open the following URL in your browser:")
	fmt.Printf("\n  %s\n\n", deviceResp.VerificationURIComplete)
	fmt.Printf("Or go to %s and enter code: %s\n\n", deviceResp.VerificationURI, deviceResp.UserCode)

	// Try to open the browser automatically
	if err := openBrowser(deviceResp.VerificationURIComplete); err != nil {
		fmt.Println("(Could not open browser automatically, please copy the URL above)")
	} else {
		fmt.Println("Browser opened. Waiting for authorization...")
	}

	// Step 2: Poll for token
	interval := time.Duration(deviceResp.Interval) * time.Second
	if interval < 5*time.Second {
		interval = 5 * time.Second
	}
	deadline := time.Now().Add(time.Duration(deviceResp.ExpiresIn) * time.Second)

	for time.Now().Before(deadline) {
		time.Sleep(interval)

		body := map[string]string{
			"device_code": deviceResp.DeviceCode,
		}

		respBody, status, err = apiPost("/api/cli/auth/device/token", body, cfg)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Error polling for token: %v\n", err)
			continue
		}

		if status == 200 {
			var tokenResp struct {
				AccessToken  string `json:"access_token"`
				RefreshToken string `json:"refresh_token"`
				TokenType    string `json:"token_type"`
				User         struct {
					ID    string `json:"id"`
					Email string `json:"email"`
				} `json:"user"`
			}
			if err := json.Unmarshal(respBody, &tokenResp); err != nil {
				fmt.Fprintf(os.Stderr, "Error: failed to parse token response: %v\n", err)
				os.Exit(1)
			}

			cfg.AccessToken = tokenResp.AccessToken
			cfg.RefreshToken = tokenResp.RefreshToken
			cfg.TokenExpiry = time.Now().Add(14 * time.Minute).Format(time.RFC3339)

			if err := saveConfig(cfg); err != nil {
				fmt.Fprintf(os.Stderr, "Error: failed to save config: %v\n", err)
				os.Exit(1)
			}

			fmt.Printf("\nAuthenticated as %s\n", tokenResp.User.Email)
			fmt.Printf("Credentials saved to %s\n", configPath())
			return
		}

		// Check error type
		var errResp struct {
			Error string `json:"error"`
		}
		if err := json.Unmarshal(respBody, &errResp); err == nil {
			switch errResp.Error {
			case "authorization_pending":
				fmt.Print(".")
				continue
			case "slow_down":
				interval += 5 * time.Second
				continue
			case "expired_token":
				fmt.Fprintln(os.Stderr, "\nError: device code expired. Please try again.")
				os.Exit(1)
			default:
				fmt.Fprintf(os.Stderr, "\nError: %s\n", errResp.Error)
				os.Exit(1)
			}
		}
	}

	fmt.Fprintln(os.Stderr, "\nError: device authorization timed out. Please try again.")
	os.Exit(1)
}

func openBrowser(url string) error {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		cmd = exec.Command("open", url)
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	default: // linux, freebsd, etc.
		cmd = exec.Command("xdg-open", url)
	}
	return cmd.Start()
}
