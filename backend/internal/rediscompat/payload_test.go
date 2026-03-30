package rediscompat

import (
	"encoding/base64"
	"testing"
)

func TestDecodeJSONPayloadAcceptsRawJSON(t *testing.T) {
	type payload struct {
		Value string `json:"value"`
	}

	var out payload
	normalized, err := DecodeJSONPayload([]byte(`{"value":"ok"}`), &out)
	if err != nil {
		t.Fatalf("DecodeJSONPayload returned error: %v", err)
	}
	if string(normalized) != `{"value":"ok"}` {
		t.Fatalf("unexpected normalized payload: %q", string(normalized))
	}
	if out.Value != "ok" {
		t.Fatalf("unexpected decoded value: %q", out.Value)
	}
}

func TestDecodeJSONPayloadAcceptsBase64WrappedJSON(t *testing.T) {
	type payload struct {
		Value string `json:"value"`
	}

	raw := []byte(`{"value":"ok"}`)
	encoded := base64.StdEncoding.EncodeToString(raw)

	var out payload
	normalized, err := DecodeJSONPayload([]byte(encoded), &out)
	if err != nil {
		t.Fatalf("DecodeJSONPayload returned error: %v", err)
	}
	if string(normalized) != string(raw) {
		t.Fatalf("unexpected normalized payload: %q", string(normalized))
	}
	if out.Value != "ok" {
		t.Fatalf("unexpected decoded value: %q", out.Value)
	}
}
