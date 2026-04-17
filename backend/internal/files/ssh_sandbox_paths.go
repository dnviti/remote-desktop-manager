package files

import (
	"net/http"
	"path"
	"regexp"
	"strings"
)

const sshSandboxRelativePathErrorText = "Only sandbox-relative paths are allowed; remote filesystem browsing is disabled."

var sshSandboxDrivePattern = regexp.MustCompile(`^[a-zA-Z]:([/\\]|$)`)

func validateSSHSandboxRelativePath(input, fieldName string, allowRoot bool) (string, error) {
	raw := strings.TrimSpace(input)
	if raw == "" {
		if allowRoot {
			return ".", nil
		}
		return "", &requestError{status: http.StatusBadRequest, message: fieldName + " is required"}
	}
	if isDisallowedSSHSandboxPath(raw) {
		return "", &requestError{status: http.StatusBadRequest, message: sshSandboxRelativePathErrorText}
	}
	clean := path.Clean(strings.TrimPrefix(raw, "./"))
	if clean == "." {
		if allowRoot {
			return ".", nil
		}
		return "", &requestError{status: http.StatusBadRequest, message: sshSandboxRelativePathErrorText}
	}
	if clean == ".." || strings.HasPrefix(clean, "../") || strings.HasPrefix(clean, "/") {
		return "", &requestError{status: http.StatusBadRequest, message: sshSandboxRelativePathErrorText}
	}
	return clean, nil
}

func isDisallowedSSHSandboxPath(raw string) bool {
	if raw == "/" || strings.HasPrefix(raw, "/") || strings.HasPrefix(raw, "\\") || strings.HasPrefix(raw, "~") {
		return true
	}
	if sshSandboxDrivePattern.MatchString(raw) {
		return true
	}
	lower := strings.ToLower(raw)
	if strings.Contains(raw, "://") || strings.HasPrefix(lower, "file:") {
		return true
	}
	for _, segment := range strings.Split(strings.ReplaceAll(raw, "\\", "/"), "/") {
		if segment == ".." {
			return true
		}
	}
	return false
}

func sshSandboxDisplayPath(relativePath string) string {
	clean := strings.TrimSpace(relativePath)
	if clean == "" || clean == "." {
		return "/"
	}
	return "/" + strings.TrimPrefix(clean, "/")
}
