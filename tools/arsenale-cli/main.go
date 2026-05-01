package main

import "github.com/dnviti/arsenale/tools/arsenale-cli/cmd"

// defaultVersion is used when not overridden by -ldflags at build time.
const defaultVersion = "1.8.0"

func main() {
	// cmd.Version can be set via: -ldflags "-X .../cmd.Version=x.y.z"
	// If not set by ldflags, use the default.
	if cmd.Version == "0.0.0" {
		cmd.Version = defaultVersion
	}
	cmd.Execute(cmd.Version)
}
