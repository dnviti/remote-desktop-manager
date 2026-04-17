package auditapi

import (
	"encoding/json"
	"errors"
	"testing"
	"time"
)

func TestCollectTenantAuditLogsPreservesManagedDetails(t *testing.T) {
	details := []byte(`{"protocol":"ssh","transferMode":"managed-payload","transferId":"corr-123","objectKey":"stage/key","remotePath":"/tmp/report.txt","fileName":"report.txt","size":42,"checksumSha256":"abc123","policyDecision":"allowed","scanResult":"clean","result":"success"}`)
	rows := &stubTenantAuditRows{
		details:   details,
		geoCoords: []float64{},
		flags:     []string{},
		createdAt: time.Unix(1, 0).UTC(),
	}

	items, err := collectTenantAuditLogs(rows)
	if err != nil {
		t.Fatalf("collectTenantAuditLogs failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d; want 1", len(items))
	}
	if string(items[0].Details) != string(details) {
		t.Fatalf("details = %s; want %s", string(items[0].Details), string(details))
	}
	var decoded map[string]any
	if err := json.Unmarshal(items[0].Details, &decoded); err != nil {
		t.Fatalf("details are not valid JSON: %v", err)
	}
	for _, key := range []string{"protocol", "transferMode", "transferId", "objectKey", "remotePath", "fileName", "size", "checksumSha256", "policyDecision", "scanResult", "result"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("details missing %q: %#v", key, decoded)
		}
	}
}

func TestCollectTenantAuditLogsPreservesManagedRDPDetails(t *testing.T) {
	details := []byte(`{"protocol":"rdp","transferMode":"managed-payload","transferId":"corr-rdp-123","objectKey":"shared-files/rdp-upload/stage/key","remotePath":"/rdp_managed_test.go","fileName":"rdp_managed_test.go","size":128,"checksumSha256":"def456","policyDecision":"allowed","scanResult":"clean","result":"success"}`)
	rows := &stubTenantAuditRows{
		details:   details,
		geoCoords: []float64{},
		flags:     []string{},
		createdAt: time.Unix(2, 0).UTC(),
	}

	items, err := collectTenantAuditLogs(rows)
	if err != nil {
		t.Fatalf("collectTenantAuditLogs failed: %v", err)
	}
	if len(items) != 1 {
		t.Fatalf("len(items) = %d; want 1", len(items))
	}
	var decoded map[string]any
	if err := json.Unmarshal(items[0].Details, &decoded); err != nil {
		t.Fatalf("details are not valid JSON: %v", err)
	}
	for _, key := range []string{"protocol", "transferMode", "transferId", "objectKey", "remotePath", "fileName", "size", "checksumSha256", "policyDecision", "scanResult", "result"} {
		if _, ok := decoded[key]; !ok {
			t.Fatalf("details missing %q: %#v", key, decoded)
		}
	}
	if got := decoded["protocol"]; got != "rdp" {
		t.Fatalf("protocol = %#v; want rdp", got)
	}
}

type stubTenantAuditRows struct {
	consumed  bool
	err       error
	details   []byte
	geoCoords []float64
	flags     []string
	createdAt time.Time
}

func (r *stubTenantAuditRows) Next() bool {
	if r.consumed {
		return false
	}
	r.consumed = true
	return true
}

func (r *stubTenantAuditRows) Scan(dest ...any) error {
	if len(dest) != 15 {
		return errors.New("unexpected scan destination count")
	}
	*dest[0].(*string) = "audit-1"
	*dest[1].(**string) = nil
	*dest[2].(**string) = nil
	*dest[3].(**string) = nil
	*dest[4].(*string) = "FILE_DOWNLOAD"
	*dest[5].(**string) = nil
	*dest[6].(**string) = nil
	*dest[7].(*[]byte) = append([]byte(nil), r.details...)
	*dest[8].(**string) = nil
	*dest[9].(**string) = nil
	*dest[10].(**string) = nil
	*dest[11].(**string) = nil
	*dest[12].(*[]float64) = append([]float64(nil), r.geoCoords...)
	*dest[13].(*[]string) = append([]string(nil), r.flags...)
	*dest[14].(*time.Time) = r.createdAt
	return nil
}

func (r *stubTenantAuditRows) Err() error {
	return r.err
}
