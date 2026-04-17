package gateways

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBuildManagedGuacdTLSEnv(t *testing.T) {
	t.Parallel()

	dir := t.TempDir()
	certPath := filepath.Join(dir, "server-cert.pem")
	keyPath := filepath.Join(dir, "server-key.pem")

	if err := os.WriteFile(certPath, []byte("-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----\n"), 0o644); err != nil {
		t.Fatalf("write cert: %v", err)
	}
	if err := os.WriteFile(keyPath, []byte("-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----\n"), 0o600); err != nil {
		t.Fatalf("write key: %v", err)
	}

	service := Service{
		GuacdTLSCert: certPath,
		GuacdTLSKey:  keyPath,
	}

	env, err := service.buildManagedGuacdTLSEnv()
	if err != nil {
		t.Fatalf("buildManagedGuacdTLSEnv returned error: %v", err)
	}

	if env["GUACD_SSL"] != "true" {
		t.Fatalf("GUACD_SSL = %q, want true", env["GUACD_SSL"])
	}
	if env["GUACD_SSL_CERT_PEM"] != "-----BEGIN CERTIFICATE-----\ncert\n-----END CERTIFICATE-----" {
		t.Fatalf("unexpected cert pem: %q", env["GUACD_SSL_CERT_PEM"])
	}
	if env["GUACD_SSL_KEY_PEM"] != "-----BEGIN PRIVATE KEY-----\nkey\n-----END PRIVATE KEY-----" {
		t.Fatalf("unexpected key pem: %q", env["GUACD_SSL_KEY_PEM"])
	}
}

func TestBuildManagedGuacdTLSEnvRequiresCertAndKey(t *testing.T) {
	t.Parallel()

	service := Service{}
	if _, err := service.buildManagedGuacdTLSEnv(); err == nil {
		t.Fatal("expected error when managed guacd tls paths are missing")
	}
}

func TestBuildManagedGatewayContainerConfigCarriesDNSServers(t *testing.T) {
	t.Parallel()

	service := Service{
		DNSServers: []string{"192.168.254.1", "192.168.254.3", "192.168.254.1"},
	}

	configs, err := service.buildManagedGatewayContainerConfig(context.Background(), gatewayRecord{
		ID:           "gw-1",
		Name:         "Managed DB Proxy",
		Type:         "DB_PROXY",
		TenantID:     "tenant-1",
		PublishPorts: false,
	}, 1)
	if err != nil {
		t.Fatalf("buildManagedGatewayContainerConfig returned error: %v", err)
	}
	if len(configs) == 0 {
		t.Fatal("expected at least one container config")
	}
	if got, want := strings.Join(configs[0].DNSServers, ","), "192.168.254.1,192.168.254.3"; got != want {
		t.Fatalf("DNSServers = %q, want %q", got, want)
	}
}

func TestBuildManagedGatewayContainerConfigBindsResolvConf(t *testing.T) {
	t.Parallel()

	service := Service{
		DNSServers:     []string{"192.168.254.1"},
		ResolvConfPath: "/tmp/arsenale-managed.resolv.conf",
	}

	configs, err := service.buildManagedGatewayContainerConfig(context.Background(), gatewayRecord{
		ID:           "gw-1",
		Name:         "Managed DB Proxy",
		Type:         "DB_PROXY",
		TenantID:     "tenant-1",
		PublishPorts: false,
	}, 1)
	if err != nil {
		t.Fatalf("buildManagedGatewayContainerConfig returned error: %v", err)
	}
	if len(configs) == 0 {
		t.Fatal("expected at least one container config")
	}
	if got, want := strings.Join(configs[0].Binds, ","), "/tmp/arsenale-managed.resolv.conf:/etc/resolv.conf:ro"; got != want {
		t.Fatalf("Binds = %q, want %q", got, want)
	}
}

func TestManagedGatewayAttachNetworksPrependsEgress(t *testing.T) {
	t.Parallel()

	service := Service{
		EgressNetwork:  "arsenale-net-egress",
		EdgeNetwork:    "arsenale-net-edge",
		GatewayNetwork: "arsenale-net-gateway",
	}

	got := service.managedGatewayAttachNetworks(gatewayRecord{Type: "MANAGED_SSH"})
	if want := "arsenale-net-egress,arsenale-net-edge,arsenale-net-gateway"; strings.Join(got, ",") != want {
		t.Fatalf("managedGatewayAttachNetworks() = %q, want %q", strings.Join(got, ","), want)
	}
}

func TestManagedGatewayImageCandidatesUseStableRemoteDefaults(t *testing.T) {
	t.Parallel()

	service := Service{}

	sshCandidates := strings.Join(service.managedGatewayImageCandidates("MANAGED_SSH"), ",")
	if strings.Contains(sshCandidates, "ghcr.io/dnviti/arsenale/ssh-gateway:latest") {
		t.Fatal("managedGatewayImageCandidates() kept latest remote ssh-gateway fallback")
	}
	if !strings.Contains(sshCandidates, "ghcr.io/dnviti/arsenale/ssh-gateway:stable") {
		t.Fatal("managedGatewayImageCandidates() missing stable remote ssh-gateway fallback")
	}

	dbProxyCandidates := strings.Join(service.managedGatewayImageCandidates("DB_PROXY"), ",")
	if strings.Contains(dbProxyCandidates, "ghcr.io/dnviti/arsenale/db-proxy:latest") {
		t.Fatal("managedGatewayImageCandidates() kept latest remote db-proxy fallback")
	}
	if !strings.Contains(dbProxyCandidates, "ghcr.io/dnviti/arsenale/db-proxy:stable") {
		t.Fatal("managedGatewayImageCandidates() missing stable remote db-proxy fallback")
	}
}
