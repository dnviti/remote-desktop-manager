// Package main provides a JSON codec for gRPC, allowing plain Go structs
// to be used as message types without protobuf code generation.
package main

import (
	"encoding/json"
	"fmt"

	"google.golang.org/grpc/encoding"
)

func init() {
	// INTENTIONAL: Register a JSON codec under the name "proto" to replace the
	// default protobuf codec. This is by design — the gocache sidecar uses plain
	// Go structs (not generated protobuf types) as gRPC messages. By overriding
	// the "proto" codec, all gRPC calls transparently use JSON serialization.
	//
	// The TypeScript client must also use JSON serialization (not proto-loader's
	// default protobuf encoding) to match. Standard gRPC tooling (grpcurl, etc.)
	// won't work against this server — use the /health HTTP endpoint for probing.
	encoding.RegisterCodec(&jsonCodec{})
}

// jsonCodec implements encoding.Codec using JSON marshaling.
// Registered under the name "proto" to intercept the default gRPC codec.
// See init() for rationale.
type jsonCodec struct{}

func (c *jsonCodec) Marshal(v interface{}) ([]byte, error) {
	return json.Marshal(v)
}

func (c *jsonCodec) Unmarshal(data []byte, v interface{}) error {
	return json.Unmarshal(data, v)
}

func (c *jsonCodec) Name() string {
	return "proto"
}

// Verify at compile time that key types have reasonable defaults.
var _ fmt.Stringer = (*GetRequest)(nil)

// Add String() methods to all message types for debugging.
func (m *GetRequest) String() string            { return fmt.Sprintf("GetRequest{Key:%s}", m.Key) }
func (m *GetResponse) String() string           { return fmt.Sprintf("GetResponse{Found:%v}", m.Found) }
func (m *SetRequest) String() string            { return fmt.Sprintf("SetRequest{Key:%s}", m.Key) }
func (m *SetResponse) String() string           { return fmt.Sprintf("SetResponse{Ok:%v}", m.Ok) }
func (m *DeleteRequest) String() string         { return fmt.Sprintf("DeleteRequest{Key:%s}", m.Key) }
func (m *DeleteResponse) String() string        { return fmt.Sprintf("DeleteResponse{Deleted:%v}", m.Deleted) }
func (m *IncrRequest) String() string           { return fmt.Sprintf("IncrRequest{Key:%s,Delta:%d}", m.Key, m.Delta) }
func (m *IncrResponse) String() string          { return fmt.Sprintf("IncrResponse{Value:%d}", m.Value) }
func (m *GetDelRequest) String() string         { return fmt.Sprintf("GetDelRequest{Key:%s}", m.Key) }
func (m *GetDelResponse) String() string        { return fmt.Sprintf("GetDelResponse{Found:%v}", m.Found) }
func (m *PublishRequest) String() string        { return fmt.Sprintf("PublishRequest{Channel:%s}", m.Channel) }
func (m *PublishResponse) String() string       { return fmt.Sprintf("PublishResponse{Receivers:%d}", m.Receivers) }
func (m *SubscribeRequest) String() string      { return fmt.Sprintf("SubscribeRequest{Channel:%s}", m.Channel) }
func (m *SubscribeResponse) String() string     { return fmt.Sprintf("SubscribeResponse{Channel:%s}", m.Channel) }
func (m *AcquireLockRequest) String() string    { return fmt.Sprintf("AcquireLockRequest{Name:%s}", m.Name) }
func (m *AcquireLockResponse) String() string   { return fmt.Sprintf("AcquireLockResponse{Acquired:%v}", m.Acquired) }
func (m *ReleaseLockRequest) String() string    { return fmt.Sprintf("ReleaseLockRequest{Name:%s}", m.Name) }
func (m *ReleaseLockResponse) String() string   { return fmt.Sprintf("ReleaseLockResponse{Released:%v}", m.Released) }
func (m *RenewLockRequest) String() string      { return fmt.Sprintf("RenewLockRequest{Name:%s}", m.Name) }
func (m *RenewLockResponse) String() string     { return fmt.Sprintf("RenewLockResponse{Renewed:%v}", m.Renewed) }
func (m *EnqueueRequest) String() string        { return fmt.Sprintf("EnqueueRequest{Queue:%s}", m.QueueName) }
func (m *EnqueueResponse) String() string       { return fmt.Sprintf("EnqueueResponse{Ok:%v}", m.Ok) }
func (m *DequeueRequest) String() string        { return fmt.Sprintf("DequeueRequest{Queue:%s}", m.QueueName) }
func (m *DequeueResponse) String() string       { return fmt.Sprintf("DequeueResponse{Found:%v}", m.Found) }
func (m *ReplicateKVRequest) String() string    { return fmt.Sprintf("ReplicateKVRequest{Key:%s}", m.Key) }
func (m *ReplicateKVResponse) String() string   { return fmt.Sprintf("ReplicateKVResponse{Applied:%d}", m.Applied) }
func (m *ReplicatePubSubRequest) String() string  { return fmt.Sprintf("ReplicatePubSubRequest{Channel:%s}", m.Channel) }
func (m *ReplicatePubSubResponse) String() string { return fmt.Sprintf("ReplicatePubSubResponse{Delivered:%d}", m.Delivered) }
func (m *HeartbeatRequest) String() string      { return fmt.Sprintf("HeartbeatRequest{PeerId:%s}", m.PeerId) }
func (m *HeartbeatResponse) String() string     { return fmt.Sprintf("HeartbeatResponse{PeerId:%s,Ok:%v}", m.PeerId, m.Ok) }
