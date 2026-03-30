// Package main provides a JSON codec for gRPC, allowing plain Go structs
// to be used as message types without protobuf code generation.
// Same pattern as the generated protobuf codec shim used elsewhere.
package main

import (
	"encoding/json"

	"google.golang.org/grpc/encoding"
)

func init() {
	// Register a JSON codec under the name "proto" to replace the default
	// protobuf codec. This matches the plain protobuf transport pattern the TS
	// client uses JSON serialization on the wire.
	encoding.RegisterCodec(&jsonCodec{})
}

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
