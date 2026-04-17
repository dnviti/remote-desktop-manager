package files

import (
	"fmt"
	"net/http"
	"testing"
)

func TestIsUploadTooLargeError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{name: "max bytes reader", err: &http.MaxBytesError{Limit: 1024}, want: true},
		{name: "multipart too large", err: fmt.Errorf("multipart: message too large"), want: true},
		{name: "generic parse error", err: fmt.Errorf("unexpected EOF"), want: false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := isUploadTooLargeError(tc.err); got != tc.want {
				t.Fatalf("isUploadTooLargeError() = %v; want %v", got, tc.want)
			}
		})
	}
}

func TestUploadTooLargeMessage(t *testing.T) {
	got := uploadTooLargeMessage(64 * 1024 * 1024)
	if got != "File exceeds maximum upload size of 64 MB" {
		t.Fatalf("uploadTooLargeMessage() = %q", got)
	}
}
