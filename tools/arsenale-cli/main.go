// Package main implements the Arsenale Connect CLI.
//
// A lightweight cross-platform CLI tool that authenticates with the Arsenale
// API, fetches short-lived credentials, generates appropriate client config,
// and launches the user's native SSH or RDP client.
//
// Commands:
//
//	arsenale login          - Authenticate via device authorization flow
//	arsenale connect ssh    - Connect to an SSH target via the Arsenale proxy
//	arsenale connect rdp    - Connect to an RDP target via RD Gateway
//	arsenale list           - List available connections
//	arsenale config         - Show or edit configuration
package main

import (
	"fmt"
	"os"

	"github.com/dnviti/arsenale/tools/arsenale-cli/cmd"
)

const version = "1.7.0"

func main() {
	if len(os.Args) < 2 {
		printUsage()
		os.Exit(1)
	}

	switch os.Args[1] {
	case "login":
		cmd.Login()
	case "connect":
		if len(os.Args) < 3 {
			fmt.Fprintln(os.Stderr, "Usage: arsenale connect <ssh|rdp> <connection-name>")
			os.Exit(1)
		}
		switch os.Args[2] {
		case "ssh":
			if len(os.Args) < 4 {
				fmt.Fprintln(os.Stderr, "Usage: arsenale connect ssh <connection-name>")
				os.Exit(1)
			}
			cmd.ConnectSSH(os.Args[3])
		case "rdp":
			if len(os.Args) < 4 {
				fmt.Fprintln(os.Stderr, "Usage: arsenale connect rdp <connection-name>")
				os.Exit(1)
			}
			cmd.ConnectRDP(os.Args[3])
		default:
			fmt.Fprintf(os.Stderr, "Unknown protocol: %s\n", os.Args[2])
			os.Exit(1)
		}
	case "list":
		cmd.List()
	case "config":
		cmd.Config()
	case "version", "--version", "-v":
		fmt.Printf("arsenale-cli v%s\n", version)
	case "help", "--help", "-h":
		printUsage()
	default:
		fmt.Fprintf(os.Stderr, "Unknown command: %s\n", os.Args[1])
		printUsage()
		os.Exit(1)
	}
}

func printUsage() {
	fmt.Printf(`Arsenale Connect CLI v%s

Usage:
  arsenale login                       Authenticate via browser-based device authorization
  arsenale connect ssh <name>          Connect to an SSH target via Arsenale proxy
  arsenale connect rdp <name>          Connect to an RDP target via RD Gateway
  arsenale list                        List available connections
  arsenale config                      Show current configuration
  arsenale version                     Show version

Configuration:
  Config file: ~/.arsenale/config.yaml
  Server URL, auth tokens, and cache TTL are stored in the config file.
  Run 'arsenale login' to authenticate for the first time.

`, version)
}
