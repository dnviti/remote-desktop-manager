package files

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

func DrivePath(basePath, userID, connectionID string) string {
	base := strings.TrimSpace(basePath)
	if base == "" {
		base = defaultDriveBasePath
	}
	return filepath.Join(base, sanitizeUserID(userID), sanitizePathComponent(connectionID))
}

func stagePrefix(protocol, tenantID, userID, connectionID string) string {
	tenantComponent := sanitizePathComponent(firstNonEmpty(strings.TrimSpace(tenantID), "global"))
	return filepath.ToSlash(filepath.Join(
		"shared-files",
		strings.ToLower(strings.TrimSpace(protocol)),
		"tenants", tenantComponent,
		"users", sanitizeUserID(userID),
		"connections", sanitizePathComponent(connectionID),
	))
}

func stageObjectKey(prefix, fileName string) string {
	return prefix + "/" + encodeObjectName(fileName)
}

func (s Service) getFilePath(userID, connectionID, fileName string) (string, error) {
	sanitized, err := validateFileName(fileName)
	if err != nil {
		return "", err
	}
	filePath := filepath.Join(s.userDrivePath(userID, connectionID), sanitized)
	if _, err := os.Stat(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", &requestError{status: 404, message: "File not found"}
		}
		return "", fmt.Errorf("stat drive file: %w", err)
	}
	return filePath, nil
}

func (s Service) ensureUserDrive(userID, connectionID string) (string, error) {
	dirPath := s.userDrivePath(userID, connectionID)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return "", fmt.Errorf("create user drive: %w", err)
	}
	return dirPath, nil
}

func (s Service) userDrivePath(userID, connectionID string) string {
	return DrivePath(s.DriveBasePath, userID, connectionID)
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

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}
