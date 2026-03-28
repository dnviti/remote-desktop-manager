// Package peer implements peer discovery and replication for the cache sidecar cluster.
package peer

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	refreshInterval     = 10 * time.Second
	healthCheckInterval = 5 * time.Second
)

// Peer represents a remote cache sidecar instance.
type Peer struct {
	ID      string
	Address string
	Healthy bool
	LastSeen time.Time
}

// Discovery is the interface for peer discovery mechanisms.
type Discovery interface {
	// Discover returns the list of peer addresses.
	Discover(ctx context.Context) ([]string, error)
}

// ManualDiscovery parses peers from the CACHE_PEERS env var.
type ManualDiscovery struct {
	peers []string
}

// NewManualDiscovery creates a ManualDiscovery from a comma-separated list.
func NewManualDiscovery(peersCSV string) *ManualDiscovery {
	var peers []string
	for _, p := range strings.Split(peersCSV, ",") {
		p = strings.TrimSpace(p)
		if p != "" {
			peers = append(peers, p)
		}
	}
	return &ManualDiscovery{peers: peers}
}

func (d *ManualDiscovery) Discover(_ context.Context) ([]string, error) {
	return d.peers, nil
}

// DNSDiscovery resolves a DNS name to peer IPs.
type DNSDiscovery struct {
	name string
	port string
}

// NewDNSDiscovery creates a DNS-based discovery strategy.
func NewDNSDiscovery(name, port string) *DNSDiscovery {
	return &DNSDiscovery{name: name, port: port}
}

func (d *DNSDiscovery) Discover(ctx context.Context) ([]string, error) {
	if d.name == "" {
		return nil, nil
	}
	ips, err := net.DefaultResolver.LookupHost(ctx, d.name)
	if err != nil {
		return nil, fmt.Errorf("dns discovery: %w", err)
	}
	peers := make([]string, 0, len(ips))
	for _, ip := range ips {
		peers = append(peers, net.JoinHostPort(ip, d.port))
	}
	return peers, nil
}

// DockerDiscovery queries the Docker API for containers with label arsenale.cache-sidecar=true.
type DockerDiscovery struct {
	socketPath string
	port       string
}

// NewDockerDiscovery creates a DockerDiscovery. It queries the Docker daemon
// via the Unix socket at /var/run/docker.sock.
func NewDockerDiscovery(port string) *DockerDiscovery {
	return &DockerDiscovery{
		socketPath: "/var/run/docker.sock",
		port:       port,
	}
}

func (d *DockerDiscovery) Discover(ctx context.Context) ([]string, error) {
	client := &http.Client{
		Transport: &http.Transport{
			DialContext: func(ctx context.Context, _, _ string) (net.Conn, error) {
				return net.DialTimeout("unix", d.socketPath, 5*time.Second)
			},
		},
		Timeout: 10 * time.Second,
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet,
		"http://docker/containers/json?filters="+`{"label":["arsenale.cache-sidecar=true"]}`,
		nil)
	if err != nil {
		return nil, fmt.Errorf("docker discovery: %w", err)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("docker discovery: %w", err)
	}
	defer resp.Body.Close()

	var containers []struct {
		NetworkSettings struct {
			Networks map[string]struct {
				IPAddress string `json:"IPAddress"`
			} `json:"Networks"`
		} `json:"NetworkSettings"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&containers); err != nil {
		return nil, fmt.Errorf("docker discovery: decode: %w", err)
	}

	var peers []string
	for _, c := range containers {
		for _, net := range c.NetworkSettings.Networks {
			if net.IPAddress != "" {
				peers = append(peers, net.IPAddress+":"+d.port)
			}
		}
	}
	return peers, nil
}

// KubernetesDiscovery uses headless service DNS SRV lookup.
type KubernetesDiscovery struct {
	serviceName string
	namespace   string
	port        string
}

// NewKubernetesDiscovery creates a KubernetesDiscovery.
// service is the headless service name, namespace defaults to "default".
func NewKubernetesDiscovery(service, namespace, port string) *KubernetesDiscovery {
	if namespace == "" {
		// Try to read from the mounted service account.
		if data, err := os.ReadFile("/var/run/secrets/kubernetes.io/serviceaccount/namespace"); err == nil {
			namespace = strings.TrimSpace(string(data))
		} else {
			namespace = "default"
		}
	}
	return &KubernetesDiscovery{
		serviceName: service,
		namespace:   namespace,
		port:        port,
	}
}

func (d *KubernetesDiscovery) Discover(ctx context.Context) ([]string, error) {
	srvName := fmt.Sprintf("_grpc._tcp.%s.%s.svc.cluster.local", d.serviceName, d.namespace)
	_, addrs, err := net.DefaultResolver.LookupSRV(ctx, "grpc", "tcp",
		fmt.Sprintf("%s.%s.svc.cluster.local", d.serviceName, d.namespace))
	if err != nil {
		// Fallback to A records.
		host := fmt.Sprintf("%s.%s.svc.cluster.local", d.serviceName, d.namespace)
		ips, err2 := net.DefaultResolver.LookupHost(ctx, host)
		if err2 != nil {
			return nil, fmt.Errorf("k8s discovery: SRV(%s) failed: %w; A record fallback failed: %v", srvName, err, err2)
		}
		var peers []string
		for _, ip := range ips {
			peers = append(peers, ip+":"+d.port)
		}
		return peers, nil
	}

	var peers []string
	for _, addr := range addrs {
		peers = append(peers, fmt.Sprintf("%s:%d", strings.TrimSuffix(addr.Target, "."), addr.Port))
	}
	return peers, nil
}

// Registry manages the known set of peers and their health status.
type Registry struct {
	mu        sync.RWMutex
	peers     map[string]*Peer
	discovery Discovery
	selfAddr  string
	selfPort  string
	selfHosts map[string]struct{}
	stopCh    chan struct{}
	onUpdate  func(peers []*Peer) // callback when peer list changes
}

// NewRegistry creates a peer Registry with the given discovery mechanism.
func NewRegistry(discovery Discovery, selfAddr string) *Registry {
	return &Registry{
		peers:     make(map[string]*Peer),
		discovery: discovery,
		selfAddr:  selfAddr,
		selfPort:  peerPort(selfAddr),
		selfHosts: collectSelfHosts(selfAddr),
		stopCh:    make(chan struct{}),
	}
}

// OnUpdate sets a callback invoked when the peer list changes.
func (r *Registry) OnUpdate(fn func(peers []*Peer)) {
	r.onUpdate = fn
}

// Start begins periodic peer discovery and health checking.
func (r *Registry) Start(ctx context.Context) {
	go r.discoveryLoop(ctx)
	go r.healthCheckLoop(ctx)
}

// Stop halts the discovery loop.
func (r *Registry) Stop() {
	close(r.stopCh)
}

// GetHealthyPeers returns all peers currently marked as healthy.
func (r *Registry) GetHealthyPeers() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()

	var result []*Peer
	for _, p := range r.peers {
		if p.Healthy {
			result = append(result, p)
		}
	}
	return result
}

// GetAllPeers returns all known peers.
func (r *Registry) GetAllPeers() []*Peer {
	r.mu.RLock()
	defer r.mu.RUnlock()

	result := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		result = append(result, p)
	}
	return result
}

// MarkHealthy marks a peer as healthy (used by heartbeat responses).
func (r *Registry) MarkHealthy(addr string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if p, ok := r.peers[addr]; ok {
		p.Healthy = true
		p.LastSeen = time.Now()
	}
}

// MarkUnhealthy marks a peer as unhealthy.
func (r *Registry) MarkUnhealthy(addr string) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if p, ok := r.peers[addr]; ok {
		p.Healthy = false
	}
}

func (r *Registry) discoveryLoop(ctx context.Context) {
	// Run immediately on start.
	r.refreshPeers(ctx)

	ticker := time.NewTicker(refreshInterval)
	defer ticker.Stop()

	for {
		select {
		case <-r.stopCh:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.refreshPeers(ctx)
		}
	}
}

func (r *Registry) healthCheckLoop(ctx context.Context) {
	ticker := time.NewTicker(healthCheckInterval)
	defer ticker.Stop()

	for {
		select {
		case <-r.stopCh:
			return
		case <-ctx.Done():
			return
		case <-ticker.C:
			r.checkPeerHealth(ctx)
		}
	}
}

func (r *Registry) checkPeerHealth(ctx context.Context) {
	r.mu.RLock()
	peers := make([]*Peer, 0, len(r.peers))
	for _, p := range r.peers {
		peers = append(peers, p)
	}
	r.mu.RUnlock()

	for _, p := range peers {
		conn, err := net.DialTimeout("tcp", p.Address, 2*time.Second)
		if err != nil {
			r.MarkUnhealthy(p.Address)
			continue
		}
		conn.Close()
		r.MarkHealthy(p.Address)
	}
}

func (r *Registry) refreshPeers(ctx context.Context) {
	addrs, err := r.discovery.Discover(ctx)
	if err != nil {
		log.Printf("[peer] discovery error: %v", err)
		return
	}

	r.mu.Lock()
	changed := false

	// Add new peers.
	seen := make(map[string]bool)
	for _, addr := range addrs {
		if r.isSelfAddress(addr) {
			continue
		}
		seen[addr] = true
		if _, ok := r.peers[addr]; !ok {
			r.peers[addr] = &Peer{
				ID:       addr,
				Address:  addr,
				Healthy:  false,
				LastSeen: time.Time{},
			}
			changed = true
		}
	}

	// Remove peers no longer discovered.
	for addr := range r.peers {
		if !seen[addr] {
			delete(r.peers, addr)
			changed = true
		}
	}
	r.mu.Unlock()

	if changed && r.onUpdate != nil {
		r.onUpdate(r.GetAllPeers())
	}
}

func peerPort(addr string) string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return ""
	}
	return port
}

func collectSelfHosts(selfAddr string) map[string]struct{} {
	hosts := map[string]struct{}{
		"localhost": {},
	}
	if hostname, err := os.Hostname(); err == nil && hostname != "" {
		hosts[hostname] = struct{}{}
	}
	if host, _, err := net.SplitHostPort(selfAddr); err == nil && host != "" && host != "0.0.0.0" && host != "::" {
		hosts[host] = struct{}{}
	}
	if addrs, err := net.InterfaceAddrs(); err == nil {
		for _, addr := range addrs {
			switch v := addr.(type) {
			case *net.IPNet:
				hosts[v.IP.String()] = struct{}{}
			case *net.IPAddr:
				hosts[v.IP.String()] = struct{}{}
			}
		}
	}
	return hosts
}

func (r *Registry) isSelfAddress(addr string) bool {
	if addr == r.selfAddr {
		return true
	}
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return false
	}
	if r.selfPort != "" && port != r.selfPort {
		return false
	}
	if _, ok := r.selfHosts[host]; ok {
		return true
	}
	ips, err := net.DefaultResolver.LookupHost(context.Background(), host)
	if err != nil {
		return false
	}
	for _, ip := range ips {
		if _, ok := r.selfHosts[ip]; ok {
			return true
		}
	}
	return false
}
