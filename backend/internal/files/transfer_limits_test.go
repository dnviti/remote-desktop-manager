package files

import (
	"errors"
	"net/http"
	"testing"
)

func TestManagedUploadLimitsUsePolicyOverrides(t *testing.T) {
	maxUpload := int64(12)
	quota := int64(34)

	limits := (Service{
		FileUploadMaxSize: 100,
		UserDriveQuota:    200,
	}).managedUploadLimits(resolvedFilePolicy{
		FileUploadMax:  &maxUpload,
		UserDriveQuota: &quota,
	})

	if limits.maxPayloadBytes != maxUpload {
		t.Fatalf("maxPayloadBytes = %d; want %d", limits.maxPayloadBytes, maxUpload)
	}
	if limits.quotaBytes != quota {
		t.Fatalf("quotaBytes = %d; want %d", limits.quotaBytes, quota)
	}
}

func TestManagedUploadLimitsUseServiceDefaults(t *testing.T) {
	limits := (Service{
		FileUploadMaxSize: 56,
		UserDriveQuota:    78,
	}).managedUploadLimits(resolvedFilePolicy{})

	if limits.maxPayloadBytes != 56 {
		t.Fatalf("maxPayloadBytes = %d; want 56", limits.maxPayloadBytes)
	}
	if limits.quotaBytes != 78 {
		t.Fatalf("quotaBytes = %d; want 78", limits.quotaBytes)
	}
}

func TestManagedUploadLimitsValidatePayloadSize(t *testing.T) {
	err := (managedUploadLimits{maxPayloadBytes: 10}).validatePayloadSize(11)

	reqErr := expectRequestError(t, err)
	if reqErr.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d; want %d", reqErr.status, http.StatusRequestEntityTooLarge)
	}
	if reqErr.message != uploadTooLargeMessage(10) {
		t.Fatalf("message = %q; want %q", reqErr.message, uploadTooLargeMessage(10))
	}
}

func TestManagedUploadLimitsValidateQuota(t *testing.T) {
	err := (managedUploadLimits{quotaBytes: 100}).validateQuota(75, 26)

	reqErr := expectRequestError(t, err)
	if reqErr.status != http.StatusRequestEntityTooLarge {
		t.Fatalf("status = %d; want %d", reqErr.status, http.StatusRequestEntityTooLarge)
	}
	if reqErr.message != quotaExceededMessage(75, 100) {
		t.Fatalf("message = %q; want %q", reqErr.message, quotaExceededMessage(75, 100))
	}
}

func TestManagedUploadLimitsAllowDisabledQuota(t *testing.T) {
	if err := (managedUploadLimits{quotaBytes: 0}).validateQuota(100, 100); err != nil {
		t.Fatalf("validateQuota() error = %v; want nil", err)
	}
}

func expectRequestError(t *testing.T, err error) *requestError {
	t.Helper()

	var reqErr *requestError
	if !errors.As(err, &reqErr) {
		t.Fatalf("error = %v; want *requestError", err)
	}
	return reqErr
}
