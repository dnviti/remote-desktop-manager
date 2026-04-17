package connections

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
	"time"
)

func TestNormalizeTransferRetentionPolicyInputForCreateUpdate(t *testing.T) {
	tests := []struct {
		name    string
		input   json.RawMessage
		want    string
		wantNil bool
	}{
		{name: "missing stays nil", input: nil, wantNil: true},
		{name: "explicit false canonicalized", input: json.RawMessage(`{"retainSuccessfulUploads":false}`), want: `{"retainSuccessfulUploads":false,"maxUploadSizeBytes":104857600}`},
		{name: "explicit true canonicalized", input: json.RawMessage(`{"retainSuccessfulUploads":true}`), want: `{"retainSuccessfulUploads":true,"maxUploadSizeBytes":104857600}`},
		{name: "explicit max canonicalized", input: json.RawMessage(`{"retainSuccessfulUploads":true,"maxUploadSizeBytes":52428800}`), want: `{"retainSuccessfulUploads":true,"maxUploadSizeBytes":52428800}`},
		{name: "missing property defaults false", input: json.RawMessage(`{}`), want: `{"retainSuccessfulUploads":false,"maxUploadSizeBytes":104857600}`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := normalizeTransferRetentionPolicyInput(tc.input)
			if err != nil {
				t.Fatalf("normalizeTransferRetentionPolicyInput returned error: %v", err)
			}
			if tc.wantNil {
				if got != nil {
					t.Fatalf("expected nil policy, got %s", string(got))
				}
				return
			}
			if string(got) != tc.want {
				t.Fatalf("unexpected policy: got %s want %s", string(got), tc.want)
			}
		})
	}
}

func TestPresentUpdateFieldsIncludesTransferRetentionPolicy(t *testing.T) {
	fields := presentUpdateFields(updatePayload{
		TransferRetentionPolicy: optionalJSON{Present: true, Value: json.RawMessage(`{"retainSuccessfulUploads":true}`)},
	})

	if len(fields) != 1 || fields[0] != "transferRetentionPolicy" {
		t.Fatalf("unexpected update fields: %#v", fields)
	}
}

func TestNormalizeTransferRetentionPolicyInputRejectsOversizedMaxUpload(t *testing.T) {
	_, err := normalizeTransferRetentionPolicyInput(json.RawMessage(`{"maxUploadSizeBytes":104857601}`))
	if err == nil {
		t.Fatal("expected error for oversized maxUploadSizeBytes")
	}
}

func TestScanSingleConnectionDefaultsTransferRetentionPolicyWhenNull(t *testing.T) {
	conn, err := scanSingleConnection(stubConnectionRowScanner{values: connectionScanValues(nil)})
	if err != nil {
		t.Fatalf("scanSingleConnection returned error: %v", err)
	}

	if string(conn.TransferRetentionPolicy) != `{"retainSuccessfulUploads":false,"maxUploadSizeBytes":104857600}` {
		t.Fatalf("unexpected default transfer retention policy: %s", string(conn.TransferRetentionPolicy))
	}
}

func TestScanSingleConnectionPreservesTransferRetentionPolicy(t *testing.T) {
	conn, err := scanSingleConnection(stubConnectionRowScanner{values: connectionScanValues([]byte(`{"retainSuccessfulUploads":true,"maxUploadSizeBytes":52428800}`))})
	if err != nil {
		t.Fatalf("scanSingleConnection returned error: %v", err)
	}

	if string(conn.TransferRetentionPolicy) != `{"retainSuccessfulUploads":true,"maxUploadSizeBytes":52428800}` {
		t.Fatalf("unexpected transfer retention policy: %s", string(conn.TransferRetentionPolicy))
	}
}

type stubConnectionRowScanner struct {
	values []any
}

func (s stubConnectionRowScanner) Scan(dest ...any) error {
	if len(dest) != len(s.values) {
		return fmt.Errorf("scan dest/value mismatch: %d != %d", len(dest), len(s.values))
	}
	for i := range dest {
		if err := assignScanValue(dest[i], s.values[i]); err != nil {
			return fmt.Errorf("scan index %d: %w", i, err)
		}
	}
	return nil
}

func assignScanValue(dest any, value any) error {
	destValue := reflect.ValueOf(dest)
	if destValue.Kind() != reflect.Pointer || destValue.IsNil() {
		return fmt.Errorf("destination must be non-nil pointer")
	}
	if value == nil {
		destValue.Elem().Set(reflect.Zero(destValue.Elem().Type()))
		return nil
	}

	valueValue := reflect.ValueOf(value)
	if valueValue.Type().AssignableTo(destValue.Elem().Type()) {
		destValue.Elem().Set(valueValue)
		return nil
	}
	if valueValue.Type().ConvertibleTo(destValue.Elem().Type()) {
		destValue.Elem().Set(valueValue.Convert(destValue.Elem().Type()))
		return nil
	}
	return fmt.Errorf("cannot assign %T to %T", value, dest)
}

func connectionScanValues(transferRetentionPolicy []byte) []any {
	createdAt := time.Unix(1_710_000_000, 0).UTC()
	return []any{
		"conn-1",
		"Sandbox SSH",
		"SSH",
		"ssh.example.com",
		22,
		(*string)(nil),
		sql.NullString{},
		sql.NullString{},
		sql.NullString{},
		sql.NullString{},
		sql.NullString{},
		sql.NullString{},
		sql.NullString{},
		false,
		false,
		sql.NullString{},
		[]byte(nil),
		[]byte(nil),
		[]byte(nil),
		[]byte(nil),
		sql.NullString{},
		[]byte(nil),
		transferRetentionPolicy,
		sql.NullString{},
		sql.NullInt32{},
		sql.NullString{},
		sql.NullString{},
		createdAt,
		createdAt,
	}
}
