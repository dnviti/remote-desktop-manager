package files

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strings"
)

func DrivePath(basePath, tenantID, userID, connectionID string) string {
	base := strings.TrimSpace(basePath)
	if base == "" {
		base = defaultDriveBasePath
	}
	return filepath.Join(
		base,
		sanitizeUserID(userID),
		sanitizePathComponent(connectionID),
	)
}

func sandboxPrefix(protocol, tenantID, userID, connectionID string) string {
	tenantComponent := sanitizePathComponent(firstNonEmpty(strings.TrimSpace(tenantID), "global"))
	return filepath.ToSlash(filepath.Join(
		"shared-files",
		normalizeSandboxProtocol(protocol),
		"tenants", tenantComponent,
		"users", sanitizeUserID(userID),
		"connections", sanitizePathComponent(connectionID),
	))
}

func stagePrefix(protocol, tenantID, userID, connectionID string) string {
	return filepath.ToSlash(filepath.Join(sandboxPrefix(protocol, tenantID, userID, connectionID), "stage"))
}

func workspaceCurrentPrefix(protocol, tenantID, userID, connectionID string) string {
	return filepath.ToSlash(filepath.Join(sandboxPrefix(protocol, tenantID, userID, connectionID), "workspace", "current"))
}

func historyUploadsPrefix(protocol, tenantID, userID, connectionID string) string {
	return filepath.ToSlash(filepath.Join(sandboxPrefix(protocol, tenantID, userID, connectionID), "history", "uploads"))
}

func stageObjectKey(prefix, fileName string) string {
	return prefix + "/" + encodeObjectName(fileName)
}

func (s Service) getFilePath(tenantID, userID, connectionID, fileName string) (string, error) {
	sanitized, err := validateFileName(fileName)
	if err != nil {
		return "", err
	}
	filePath := filepath.Join(s.userDrivePath(tenantID, userID, connectionID), sanitized)
	if _, err := os.Stat(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", &requestError{status: 404, message: "File not found"}
		}
		return "", fmt.Errorf("stat drive file: %w", err)
	}
	return filePath, nil
}

func (s Service) ensureUserDrive(tenantID, userID, connectionID string) (string, error) {
	dirPath := s.userDrivePath(tenantID, userID, connectionID)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return "", fmt.Errorf("create user drive: %w", err)
	}
	return dirPath, nil
}

func (s Service) userDrivePath(tenantID, userID, connectionID string) string {
	return DrivePath(s.DriveBasePath, tenantID, userID, connectionID)
}

func sanitizeUserID(userID string) string {
	safe := unsafeUserIDPattern.ReplaceAllString(userID, "")
	if safe == "" {
		return "unknown"
	}
	return safe
}

func sanitizePathComponent(value string) string {
	safe := unsafeUserIDPattern.ReplaceAllString(strings.TrimSpace(value), "")
	if safe == "" {
		return "unknown"
	}
	return safe
}

func displayPathComponent(value, fallback string) string {
	slug := strings.ToLower(strings.TrimSpace(value))
	slug = unsafeDisplayPathPattern.ReplaceAllString(slug, "-")
	slug = strings.Trim(slug, "-")
	if slug == "" {
		return strings.ToLower(strings.TrimSpace(firstNonEmpty(fallback, "unknown")))
	}
	return slug
}

func displayScopedPathComponent(value, fallback, stableKey string) string {
	base := displayPathComponent(value, fallback)
	stableKey = strings.TrimSpace(stableKey)
	if stableKey == "" {
		stableKey = base
	}
	hash := sha256.Sum256([]byte(stableKey))
	return base + "--" + hex.EncodeToString(hash[:4])
}

func validateFileName(fileName string) (string, error) {
	sanitized := strings.TrimSpace(fileName)
	if sanitized == "" || len(sanitized) > maxFileNameLength {
		return "", &requestError{status: 400, message: "Invalid file name"}
	}
	if strings.ContainsAny(sanitized, `/\`) || filepath.Base(sanitized) != sanitized {
		return "", &requestError{status: 400, message: "Invalid file name"}
	}
	return sanitized, nil
}

func sanitizeUploadName(fileName string) string {
	name := strings.TrimSpace(filepath.Base(fileName))
	name = unsafeUploadNamePattern.ReplaceAllString(name, "_")
	if name == "" || name == "." || name == ".." {
		name = "upload.bin"
	}
	if len(name) > maxFileNameLength {
		name = name[:maxFileNameLength]
	}
	return name
}

func encodeObjectName(fileName string) string {
	return url.PathEscape(strings.TrimSpace(fileName))
}

func decodeObjectName(encoded string) string {
	decoded, err := url.PathUnescape(encoded)
	if err != nil {
		return encoded
	}
	return decoded
}

func normalizeSandboxProtocol(protocol string) string {
	normalized := strings.ToLower(strings.TrimSpace(protocol))
	for _, suffix := range []string{"-upload", "-download"} {
		normalized = strings.TrimSuffix(normalized, suffix)
	}
	if normalized == "" {
		return "unknown"
	}
	return normalized
}

func SSHWorkspaceMirrorPath(homeDir, tenantID, userID, connectionID string) string {
	home := normalizeSSHRemoteBasePath(homeDir)
	return joinSSHRemotePath(home, ".arsenale-transfer", displayPathComponent(firstNonEmpty(tenantID, "tenant"), "tenant"), displayPathComponent(firstNonEmpty(userID, "user"), "user"), displayPathComponent(firstNonEmpty(connectionID, "connection"), "connection"), "workspace")
}

func sshWorkspaceMirrorPathForScope(homeDir string, scope managedSandboxScope) string {
	home := normalizeSSHRemoteBasePath(homeDir)
	return joinSSHRemotePath(
		home,
		".arsenale-transfer",
		displayScopedPathComponent(firstNonEmpty(scope.TenantLabel, scope.TenantID), "tenant", scope.TenantID),
		displayScopedPathComponent(firstNonEmpty(scope.UserLabel, scope.UserID), "user", scope.UserID),
		displayScopedPathComponent(firstNonEmpty(scope.ConnectionLabel, scope.ConnectionID), "connection", scope.ConnectionID),
		"workspace",
	)
}

func normalizeSSHRemoteBasePath(value string) string {
	normalized := strings.TrimSpace(strings.ReplaceAll(value, `\`, "/"))
	if normalized == "" {
		return "/"
	}
	if len(normalized) >= 4 && normalized[0] == '/' && isASCIIAlpha(normalized[1]) && normalized[2] == ':' && normalized[3] == '/' {
		normalized = normalized[1:]
	}
	if isSSHWindowsDrivePath(normalized) {
		drive := strings.ToUpper(normalized[:1]) + ":"
		rest := strings.TrimPrefix(normalized[2:], "/")
		if rest == "" {
			return drive + "/"
		}
		return drive + "/" + strings.TrimPrefix(path.Clean("/"+rest), "/")
	}
	cleaned := path.Clean(normalized)
	if cleaned == "." || cleaned == "" {
		return "/"
	}
	if !strings.HasPrefix(cleaned, "/") {
		cleaned = "/" + cleaned
	}
	return cleaned
}

func isSSHWindowsDrivePath(value string) bool {
	return len(value) >= 3 && isASCIIAlpha(value[0]) && value[1] == ':' && value[2] == '/'
}

func joinSSHRemotePath(base string, parts ...string) string {
	current := normalizeSSHRemoteBasePath(base)
	for _, part := range parts {
		for _, segment := range strings.Split(strings.ReplaceAll(strings.TrimSpace(part), `\`, "/"), "/") {
			if segment == "" || segment == "." {
				continue
			}
			if current == "/" {
				current = "/" + segment
				continue
			}
			if strings.HasSuffix(current, "/") {
				current += segment
			} else {
				current += "/" + segment
			}
		}
	}
	return current
}

func isASCIIAlpha(value byte) bool {
	return (value >= 'a' && value <= 'z') || (value >= 'A' && value <= 'Z')
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
