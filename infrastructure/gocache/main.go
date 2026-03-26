// Package main implements the gocache sidecar — an in-process cache, pub/sub,
// lock manager, and queue exposed over gRPC.
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/dnviti/arsenale/infrastructure/gocache/kv"
	lockpkg "github.com/dnviti/arsenale/infrastructure/gocache/lock"
	"github.com/dnviti/arsenale/infrastructure/gocache/peer"
	"github.com/dnviti/arsenale/infrastructure/gocache/pubsub"
	"github.com/dnviti/arsenale/infrastructure/gocache/queue"
	"google.golang.org/grpc"
	"google.golang.org/grpc/reflection"
)

// config holds all runtime configuration parsed from env vars.
type config struct {
	listenAddr        string // tcp://host:port or unix:///path
	healthPort        int
	maxMemory         int64
	replicationBuffer int
	discoveryMode     string // docker | kubernetes | manual
	peers             string
	k8sService        string
	k8sNamespace      string
}

func parseConfig() config {
	cfg := config{
		listenAddr:        envOrDefault("CACHE_LISTEN", "tcp://localhost:6380"),
		healthPort:        envIntOrDefault("CACHE_HEALTH_PORT", 6381),
		maxMemory:         parseBytes(envOrDefault("CACHE_MAX_MEMORY", "256mb")),
		replicationBuffer: int(parseBytes(envOrDefault("CACHE_REPLICATION_BUFFER", "10mb"))),
		discoveryMode:     envOrDefault("CACHE_DISCOVERY", "manual"),
		peers:             os.Getenv("CACHE_PEERS"),
		k8sService:        envOrDefault("CACHE_K8S_SERVICE", "gocache"),
		k8sNamespace:      os.Getenv("CACHE_K8S_NAMESPACE"),
	}
	return cfg
}

func main() {
	cfg := parseConfig()

	// Initialize subsystems.
	store := kv.New(cfg.maxMemory)
	defer store.Close()

	broker := pubsub.New()

	lockMgr := lockpkg.New()
	defer lockMgr.Close()

	queueMgr := queue.New()

	// Peer discovery.
	var discovery peer.Discovery
	listenAddr := parseListenAddr(cfg.listenAddr)
	grpcPort := extractPort(listenAddr)

	switch cfg.discoveryMode {
	case "docker":
		discovery = peer.NewDockerDiscovery(grpcPort)
	case "kubernetes":
		discovery = peer.NewKubernetesDiscovery(cfg.k8sService, cfg.k8sNamespace, grpcPort)
	default:
		discovery = peer.NewManualDiscovery(cfg.peers)
	}

	registry := peer.NewRegistry(discovery, listenAddr)
	replicationEngine := peer.NewEngine(registry, cfg.replicationBuffer)

	// Wire replication callbacks.
	replicationEngine.OnKVSet = func(key string, value []byte, ttlMs int64, timestamp uint64) {
		var ttl time.Duration
		if ttlMs > 0 {
			ttl = time.Duration(ttlMs) * time.Millisecond
		}
		store.Set(key, value, ttl)
	}
	replicationEngine.OnKVDelete = func(key string, timestamp uint64) {
		store.Delete(key)
	}
	replicationEngine.OnPubSub = func(channel string, message []byte) {
		broker.DeliverLocal(channel, message)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	registry.Start(ctx)
	defer registry.Stop()
	replicationEngine.Start()
	defer replicationEngine.Stop()

	// gRPC server.
	svc := &cacheServiceServer{
		store:       store,
		broker:      broker,
		lockMgr:     lockMgr,
		queueMgr:    queueMgr,
		replication: replicationEngine,
	}

	grpcServer := grpc.NewServer()
	RegisterCacheServiceServer(grpcServer, svc)
	reflection.Register(grpcServer)

	// Listen (TCP or Unix socket).
	network, addr := parseNetworkAddr(cfg.listenAddr)
	lis, err := net.Listen(network, addr)
	if err != nil {
		log.Fatalf("[main] failed to listen on %s://%s: %v", network, addr, err)
	}
	defer lis.Close()

	log.Printf("[main] gRPC server listening on %s://%s", network, addr)

	// HTTP health endpoint.
	healthMux := http.NewServeMux()
	healthMux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		status := map[string]interface{}{
			"status":      "ok",
			"memory_used": store.UsedMemory(),
			"memory_max":  cfg.maxMemory,
			"peers":       len(registry.GetAllPeers()),
			"healthy_peers": len(registry.GetHealthyPeers()),
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(status)
	})
	healthServer := &http.Server{
		Addr:    fmt.Sprintf(":%d", cfg.healthPort),
		Handler: healthMux,
	}
	go func() {
		log.Printf("[main] health endpoint on :%d/health", cfg.healthPort)
		if err := healthServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Printf("[main] health server error: %v", err)
		}
	}()

	// Start gRPC in background.
	go func() {
		if err := grpcServer.Serve(lis); err != nil {
			log.Printf("[main] gRPC server error: %v", err)
		}
	}()

	// Graceful shutdown.
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)
	<-sigCh

	log.Println("[main] shutting down...")

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()

	healthServer.Shutdown(shutdownCtx)
	grpcServer.GracefulStop()
	cancel()

	log.Println("[main] shutdown complete")
}

// --- gRPC Service Implementation ---

// cacheServiceServer implements the CacheService gRPC service.
type cacheServiceServer struct {
	UnimplementedCacheServiceServer
	store       *kv.Store
	broker      *pubsub.Broker
	lockMgr     *lockpkg.Manager
	queueMgr    *queue.Manager
	replication *peer.Engine
}

func (s *cacheServiceServer) Get(_ context.Context, req *GetRequest) (*GetResponse, error) {
	val, found := s.store.Get(req.Key)
	return &GetResponse{Value: val, Found: found}, nil
}

func (s *cacheServiceServer) Set(_ context.Context, req *SetRequest) (*SetResponse, error) {
	var ttl time.Duration
	if req.TtlMs > 0 {
		ttl = time.Duration(req.TtlMs) * time.Millisecond
	}
	s.store.Set(req.Key, req.Value, ttl)
	s.replication.ReplicateKVSet(req.Key, req.Value, req.TtlMs)
	return &SetResponse{Ok: true}, nil
}

func (s *cacheServiceServer) Delete(_ context.Context, req *DeleteRequest) (*DeleteResponse, error) {
	deleted := s.store.Delete(req.Key)
	if deleted {
		s.replication.ReplicateKVDelete(req.Key)
	}
	return &DeleteResponse{Deleted: deleted}, nil
}

func (s *cacheServiceServer) Incr(_ context.Context, req *IncrRequest) (*IncrResponse, error) {
	val := s.store.Incr(req.Key, req.Delta)
	return &IncrResponse{Value: val}, nil
}

func (s *cacheServiceServer) GetDel(_ context.Context, req *GetDelRequest) (*GetDelResponse, error) {
	val, found := s.store.GetDel(req.Key)
	if found {
		s.replication.ReplicateKVDelete(req.Key)
	}
	return &GetDelResponse{Value: val, Found: found}, nil
}

func (s *cacheServiceServer) Publish(_ context.Context, req *PublishRequest) (*PublishResponse, error) {
	count, _ := s.broker.Publish(req.Channel, req.Message)
	s.replication.ReplicatePubSub(req.Channel, req.Message)
	return &PublishResponse{Receivers: int32(count)}, nil
}

func (s *cacheServiceServer) Subscribe(req *SubscribeRequest, stream CacheService_SubscribeServer) error {
	var sub *pubsub.Subscriber
	if req.Pattern {
		sub = s.broker.PSubscribe(req.Channel)
	} else {
		sub = s.broker.Subscribe(req.Channel)
	}
	defer s.broker.Unsubscribe(sub)

	for {
		select {
		case msg, ok := <-sub.Ch:
			if !ok {
				return nil
			}
			if err := stream.Send(&SubscribeResponse{
				Channel: msg.Channel,
				Message: msg.Data,
			}); err != nil {
				return err
			}
		case <-stream.Context().Done():
			return stream.Context().Err()
		}
	}
}

func (s *cacheServiceServer) AcquireLock(_ context.Context, req *AcquireLockRequest) (*AcquireLockResponse, error) {
	ttl := time.Duration(req.TtlMs) * time.Millisecond
	acquired, token := s.lockMgr.AcquireLock(req.Name, ttl, req.HolderId)
	return &AcquireLockResponse{Acquired: acquired, FencingToken: token}, nil
}

func (s *cacheServiceServer) ReleaseLock(_ context.Context, req *ReleaseLockRequest) (*ReleaseLockResponse, error) {
	released := s.lockMgr.ReleaseLock(req.Name, req.HolderId)
	return &ReleaseLockResponse{Released: released}, nil
}

func (s *cacheServiceServer) RenewLock(_ context.Context, req *RenewLockRequest) (*RenewLockResponse, error) {
	ttl := time.Duration(req.TtlMs) * time.Millisecond
	renewed := s.lockMgr.RenewLock(req.Name, ttl, req.HolderId)
	return &RenewLockResponse{Renewed: renewed}, nil
}

func (s *cacheServiceServer) Enqueue(_ context.Context, req *EnqueueRequest) (*EnqueueResponse, error) {
	s.queueMgr.Enqueue(req.QueueName, req.Message)
	return &EnqueueResponse{Ok: true}, nil
}

func (s *cacheServiceServer) Dequeue(ctx context.Context, req *DequeueRequest) (*DequeueResponse, error) {
	if req.TimeoutMs <= 0 {
		data, found := s.queueMgr.Dequeue(req.QueueName, 0)
		return &DequeueResponse{Message: data, Found: found}, nil
	}
	// Use a context that respects both the gRPC client cancellation and the requested timeout.
	timeoutCtx, cancel := context.WithTimeout(ctx, time.Duration(req.TimeoutMs)*time.Millisecond)
	defer cancel()
	data, found := s.queueMgr.DequeueContext(timeoutCtx, req.QueueName)
	return &DequeueResponse{Message: data, Found: found}, nil
}

func (s *cacheServiceServer) ReplicateKV(stream CacheService_ReplicateKVServer) error {
	count := 0
	for {
		req, err := stream.Recv()
		if err != nil {
			return stream.SendAndClose(&ReplicateKVResponse{Applied: int32(count)})
		}
		entry := peer.ReplicationEntry{
			Key:       req.Key,
			Value:     req.Value,
			TTLMs:     req.TtlMs,
			Timestamp: req.Timestamp,
		}
		if req.Deleted {
			entry.Op = peer.OpKVDelete
		} else {
			entry.Op = peer.OpKVSet
		}
		s.replication.HandleIncoming(entry)
		count++
	}
}

func (s *cacheServiceServer) ReplicatePubSub(stream CacheService_ReplicatePubSubServer) error {
	count := 0
	for {
		req, err := stream.Recv()
		if err != nil {
			return stream.SendAndClose(&ReplicatePubSubResponse{Delivered: int32(count)})
		}
		entry := peer.ReplicationEntry{
			Op:      peer.OpPubSub,
			Channel: req.Channel,
			Message: req.Message,
		}
		s.replication.HandleIncoming(entry)
		count++
	}
}

func (s *cacheServiceServer) Heartbeat(_ context.Context, req *HeartbeatRequest) (*HeartbeatResponse, error) {
	return &HeartbeatResponse{PeerId: req.PeerId, Ok: true}, nil
}

// --- Helpers ---

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func envIntOrDefault(key string, def int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func parseBytes(s string) int64 {
	s = strings.TrimSpace(strings.ToLower(s))
	multiplier := int64(1)
	if strings.HasSuffix(s, "gb") {
		multiplier = 1024 * 1024 * 1024
		s = strings.TrimSuffix(s, "gb")
	} else if strings.HasSuffix(s, "mb") {
		multiplier = 1024 * 1024
		s = strings.TrimSuffix(s, "mb")
	} else if strings.HasSuffix(s, "kb") {
		multiplier = 1024
		s = strings.TrimSuffix(s, "kb")
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(s), 10, 64)
	return n * multiplier
}

func parseListenAddr(listen string) string {
	if strings.HasPrefix(listen, "tcp://") {
		return strings.TrimPrefix(listen, "tcp://")
	}
	if strings.HasPrefix(listen, "unix://") {
		return strings.TrimPrefix(listen, "unix://")
	}
	return listen
}

func parseNetworkAddr(listen string) (string, string) {
	if strings.HasPrefix(listen, "unix://") {
		return "unix", strings.TrimPrefix(listen, "unix://")
	}
	return "tcp", parseListenAddr(listen)
}

func extractPort(addr string) string {
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return "6380"
	}
	return port
}

