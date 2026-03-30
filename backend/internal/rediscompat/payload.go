package rediscompat

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
)

// NormalizeJSONPayload accepts either raw JSON bytes or the legacy Node
// base64-wrapped JSON cache format and returns canonical raw JSON bytes.
func NormalizeJSONPayload(raw []byte) ([]byte, error) {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return nil, fmt.Errorf("empty payload")
	}

	switch trimmed[0] {
	case '{', '[', '"':
		return trimmed, nil
	}

	decoded, err := base64.StdEncoding.DecodeString(string(trimmed))
	if err != nil {
		return nil, fmt.Errorf("decode base64 payload: %w", err)
	}
	decoded = bytes.TrimSpace(decoded)
	if len(decoded) == 0 {
		return nil, fmt.Errorf("empty decoded payload")
	}
	switch decoded[0] {
	case '{', '[', '"':
		return decoded, nil
	default:
		return nil, fmt.Errorf("decoded payload is not json")
	}
}

func DecodeJSONPayload(raw []byte, target any) ([]byte, error) {
	normalized, err := NormalizeJSONPayload(raw)
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal(normalized, target); err != nil {
		return nil, err
	}
	return normalized, nil
}
