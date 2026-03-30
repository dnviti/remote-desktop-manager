// Hand-written gRPC service definition for KeyManagement.
// Uses JSON codec (no protobuf code generation required).
// Same pattern as the generated protobuf service implementation used elsewhere.
package main

import (
	"context"
	"fmt"

	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

// Message types (JSON-encoded on the wire via codec.go).

type PushKeyRequest struct {
	PublicKey string `json:"public_key"`
}

type PushKeyResponse struct {
	Ok      bool   `json:"ok"`
	Message string `json:"message"`
}

type GetKeysRequest struct{}

type GetKeysResponse struct {
	Keys []string `json:"keys"`
}

// String() for debugging.
func (m *PushKeyRequest) String() string  { return fmt.Sprintf("PushKeyRequest{PublicKey:%s...}", truncate(m.PublicKey, 30)) }
func (m *PushKeyResponse) String() string { return fmt.Sprintf("PushKeyResponse{Ok:%v}", m.Ok) }
func (m *GetKeysRequest) String() string  { return "GetKeysRequest{}" }
func (m *GetKeysResponse) String() string { return fmt.Sprintf("GetKeysResponse{Keys:%d}", len(m.Keys)) }

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n]
}

// KeyManagementServer is the server API.
type KeyManagementServer interface {
	PushKey(context.Context, *PushKeyRequest) (*PushKeyResponse, error)
	GetKeys(context.Context, *GetKeysRequest) (*GetKeysResponse, error)
}

// UnimplementedKeyManagementServer provides default implementations.
type UnimplementedKeyManagementServer struct{}

func (UnimplementedKeyManagementServer) PushKey(context.Context, *PushKeyRequest) (*PushKeyResponse, error) {
	return nil, status.Error(codes.Unimplemented, "method PushKey not implemented")
}

func (UnimplementedKeyManagementServer) GetKeys(context.Context, *GetKeysRequest) (*GetKeysResponse, error) {
	return nil, status.Error(codes.Unimplemented, "method GetKeys not implemented")
}

// Service descriptor and registration.

var _KeyManagement_serviceDesc = grpc.ServiceDesc{
	ServiceName: "keymanagement.KeyManagement",
	HandlerType: (*KeyManagementServer)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "PushKey", Handler: _KeyManagement_PushKey_Handler},
		{MethodName: "GetKeys", Handler: _KeyManagement_GetKeys_Handler},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "keymanagement",
}

func RegisterKeyManagementServer(s *grpc.Server, srv KeyManagementServer) {
	s.RegisterService(&_KeyManagement_serviceDesc, srv)
}

// Method handlers.

func _KeyManagement_PushKey_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(PushKeyRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KeyManagementServer).PushKey(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/keymanagement.KeyManagement/PushKey"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KeyManagementServer).PushKey(ctx, req.(*PushKeyRequest))
	})
}

func _KeyManagement_GetKeys_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetKeysRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KeyManagementServer).GetKeys(ctx, in)
	}
	info := &grpc.UnaryServerInfo{Server: srv, FullMethod: "/keymanagement.KeyManagement/GetKeys"}
	return interceptor(ctx, in, info, func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KeyManagementServer).GetKeys(ctx, req.(*GetKeysRequest))
	})
}
