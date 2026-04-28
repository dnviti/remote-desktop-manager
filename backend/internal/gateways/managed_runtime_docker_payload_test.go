package gateways

import (
	"reflect"
	"testing"
	"time"
)

func TestBuildDockerCreateSpecNormalizesContainerRuntimePayload(t *testing.T) {
	t.Parallel()

	spec := buildDockerCreateSpec(managedContainerConfig{
		Image: "image:tag",
		Name:  "gateway-1",
		Env: map[string]string{
			"B": "2",
			"A": "1",
		},
		Labels: map[string]string{"managed": "true"},
		Ports: []managedContainerPortBinding{
			{ContainerPort: 5432, HostPort: 15432, Publish: true},
			{ContainerPort: 9000},
			{ContainerPort: 0, HostPort: 1000, Publish: true},
		},
		Networks:      []string{" edge ", "gateway", "edge"},
		DNSServers:    []string{"10.0.0.2", "10.0.0.2", "10.0.0.3"},
		Binds:         []string{"/tmp/resolv.conf:/etc/resolv.conf:ro"},
		User:          "1000:1000",
		RestartPolicy: "on-failure",
		Healthcheck: &managedContainerHealthcheck{
			Test:        []string{"CMD", "health"},
			IntervalSec: 2,
			TimeoutSec:  3,
			Retries:     4,
			StartPeriod: 5,
		},
	})

	if got, want := spec.payload["Env"], []string{"A=1", "B=2"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Env = %#v; want %#v", got, want)
	}
	if got, want := spec.secondaryNetworks, []string{"gateway"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("secondaryNetworks = %#v; want %#v", got, want)
	}
	if got, want := spec.containerPorts, map[int]int{5432: 5432, 9000: 9000}; !reflect.DeepEqual(got, want) {
		t.Fatalf("containerPorts = %#v; want %#v", got, want)
	}

	hostConfig := spec.payload["HostConfig"].(map[string]any)
	if got, want := hostConfig["NetworkMode"], "edge"; got != want {
		t.Fatalf("NetworkMode = %#v; want %#v", got, want)
	}
	if got, want := hostConfig["Dns"], []string{"10.0.0.2", "10.0.0.3"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("Dns = %#v; want %#v", got, want)
	}
	portBindings := hostConfig["PortBindings"].(map[string][]map[string]string)
	if got, want := portBindings["5432/tcp"], []map[string]string{{"HostIp": "127.0.0.1", "HostPort": "15432"}}; !reflect.DeepEqual(got, want) {
		t.Fatalf("5432/tcp binding = %#v; want %#v", got, want)
	}

	healthcheck := spec.payload["Healthcheck"].(map[string]any)
	if got, want := healthcheck["Interval"], int64(2*time.Second); got != want {
		t.Fatalf("health interval = %#v; want %#v", got, want)
	}
}

func TestBuildDockerCreateSpecDefaultsRestartPolicy(t *testing.T) {
	t.Parallel()

	spec := buildDockerCreateSpec(managedContainerConfig{})
	hostConfig := spec.payload["HostConfig"].(map[string]any)
	restartPolicy := hostConfig["RestartPolicy"].(map[string]string)

	if got := restartPolicy["Name"]; got != "always" {
		t.Fatalf("restart policy = %q; want always", got)
	}
}
