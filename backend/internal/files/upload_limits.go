package files

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
)

func uploadTooLargeMessage(limitBytes int64) string {
	if limitBytes <= 0 {
		return "File exceeds maximum upload size"
	}
	if limitBytes%(1024*1024) == 0 {
		return fmt.Sprintf("File exceeds maximum upload size of %d MB", limitBytes/(1024*1024))
	}
	return fmt.Sprintf("File exceeds maximum upload size of %.1f MB", float64(limitBytes)/(1024*1024))
}

func isUploadTooLargeError(err error) bool {
	if err == nil {
		return false
	}
	var maxErr *http.MaxBytesError
	if errors.As(err, &maxErr) {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "request entity too large") ||
		strings.Contains(lower, "request body too large") ||
		strings.Contains(lower, "message too large")
}
