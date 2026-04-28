package gateways

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"
)

type dockerCreateSpec struct {
	payload           map[string]any
	containerPorts    map[int]int
	secondaryNetworks []string
}

func buildDockerCreateSpec(cfg managedContainerConfig) dockerCreateSpec {
	networks := normalizedStrings(cfg.Networks)
	dnsServers := normalizedStrings(cfg.DNSServers)
	primaryNetwork := ""
	if len(networks) > 0 {
		primaryNetwork = networks[0]
	}

	exposedPorts := make(map[string]map[string]struct{})
	portBindings := make(map[string][]map[string]string)
	containerPorts := make(map[int]int)
	for _, port := range cfg.Ports {
		if port.ContainerPort <= 0 {
			continue
		}
		key := fmt.Sprintf("%d/tcp", port.ContainerPort)
		exposedPorts[key] = map[string]struct{}{}
		containerPorts[port.ContainerPort] = port.ContainerPort
		if port.Publish && port.HostPort > 0 {
			portBindings[key] = []map[string]string{{
				"HostIp":   "127.0.0.1",
				"HostPort": strconv.Itoa(port.HostPort),
			}}
		}
	}

	envPairs := make([]string, 0, len(cfg.Env))
	envKeys := make([]string, 0, len(cfg.Env))
	for key := range cfg.Env {
		envKeys = append(envKeys, key)
	}
	sort.Strings(envKeys)
	for _, key := range envKeys {
		envPairs = append(envPairs, key+"="+cfg.Env[key])
	}

	restartPolicy := strings.TrimSpace(cfg.RestartPolicy)
	if restartPolicy == "" {
		restartPolicy = "always"
	}

	hostConfig := map[string]any{
		"PortBindings": portBindings,
		"RestartPolicy": map[string]string{
			"Name": restartPolicy,
		},
		"Binds": cfg.Binds,
	}
	payload := map[string]any{
		"Image":      cfg.Image,
		"Env":        envPairs,
		"Labels":     cfg.Labels,
		"HostConfig": hostConfig,
	}
	if cfg.User != "" {
		payload["User"] = cfg.User
	}
	if len(exposedPorts) > 0 {
		payload["ExposedPorts"] = exposedPorts
	}
	if primaryNetwork != "" {
		hostConfig["NetworkMode"] = primaryNetwork
	}
	if len(dnsServers) > 0 {
		hostConfig["Dns"] = dnsServers
	}
	if cfg.Healthcheck != nil {
		payload["Healthcheck"] = map[string]any{
			"Test":        cfg.Healthcheck.Test,
			"Interval":    int64(cfg.Healthcheck.IntervalSec) * int64(time.Second),
			"Timeout":     int64(cfg.Healthcheck.TimeoutSec) * int64(time.Second),
			"Retries":     cfg.Healthcheck.Retries,
			"StartPeriod": int64(cfg.Healthcheck.StartPeriod) * int64(time.Second),
		}
	}

	secondaryNetworks := []string{}
	if len(networks) > 1 {
		secondaryNetworks = networks[1:]
	}

	return dockerCreateSpec{
		payload:           payload,
		containerPorts:    containerPorts,
		secondaryNetworks: secondaryNetworks,
	}
}
