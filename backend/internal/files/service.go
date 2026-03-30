package files

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultDriveBasePath  = "/guacd-drive"
	defaultMaxUploadBytes = 10 * 1024 * 1024
	defaultUserQuotaBytes = 100 * 1024 * 1024
	multipartOverhead     = 1024 * 1024
	maxFileNameLength     = 255
)

var unsafeUserIDPattern = regexp.MustCompile(`[^a-zA-Z0-9-]`)
var unsafeUploadNamePattern = regexp.MustCompile(`[^a-zA-Z0-9._-]`)

type Service struct {
	DB                *pgxpool.Pool
	DriveBasePath     string
	FileUploadMaxSize int64
	UserDriveQuota    int64
}

type requestError struct {
	status  int
	message string
}

func (e *requestError) Error() string {
	return e.message
}

type FileInfo struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	ModifiedAt string `json:"modifiedAt"`
}

type tenantFilePolicy struct {
	DLPDisableDownload bool
	DLPDisableUpload   bool
	FileUploadMaxBytes *int64
	UserDriveQuota     *int64
}

func (s Service) HandleList(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	files, err := s.ListFiles(claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, files)
}

func (s Service) HandleDownload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	policy, err := s.loadTenantPolicy(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if policy.DLPDisableDownload {
		app.ErrorJSON(w, http.StatusForbidden, "File download is disabled by organization policy")
		return
	}

	name := strings.TrimSpace(r.PathValue("name"))
	filePath, err := s.getFilePath(claims.UserID, name)
	if err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	file, err := os.Open(filePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			app.ErrorJSON(w, http.StatusNotFound, "File not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	defer file.Close()

	stat, err := file.Stat()
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	http.ServeContent(w, r, name, stat.ModTime(), file)
}

func (s Service) HandleUpload(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	policy, err := s.loadTenantPolicy(r.Context(), claims.TenantID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if policy.DLPDisableUpload {
		app.ErrorJSON(w, http.StatusForbidden, "File upload is disabled by organization policy")
		return
	}

	maxUploadBytes := s.maxUploadBytes()
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+multipartOverhead)
	if err := r.ParseMultipartForm(maxUploadBytes + multipartOverhead); err != nil {
		var maxErr *http.MaxBytesError
		if errors.As(err, &maxErr) {
			app.ErrorJSON(w, http.StatusRequestEntityTooLarge, "File exceeds maximum upload size")
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid multipart form data")
		return
	}
	if r.MultipartForm != nil {
		defer r.MultipartForm.RemoveAll()
	}

	src, header, err := r.FormFile("file")
	if err != nil {
		if errors.Is(err, http.ErrMissingFile) {
			app.ErrorJSON(w, http.StatusBadRequest, "No file uploaded")
			return
		}
		app.ErrorJSON(w, http.StatusBadRequest, "Invalid file upload")
		return
	}
	defer src.Close()

	safeName := sanitizeUploadName(header.Filename)
	maxTenantBytes := policy.FileUploadMaxBytes
	if maxTenantBytes != nil && header.Size > *maxTenantBytes {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("File exceeds organization limit of %dMB", bytesToMB(*maxTenantBytes)))
		return
	}

	currentUsage, err := s.currentUsage(claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	if quota := s.effectiveQuota(policy); quota > 0 && currentUsage+max(header.Size, 0) > quota {
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, quotaExceededMessage(currentUsage, quota))
		return
	}

	drivePath, err := s.ensureUserDrive(claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	targetPath := filepath.Join(drivePath, safeName)
	dst, err := os.Create(targetPath)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}

	written, copyErr := io.Copy(dst, src)
	closeErr := dst.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(targetPath)
		if copyErr != nil {
			app.ErrorJSON(w, http.StatusServiceUnavailable, copyErr.Error())
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, closeErr.Error())
		return
	}

	if maxTenantBytes != nil && written > *maxTenantBytes {
		_ = os.Remove(targetPath)
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, fmt.Sprintf("File exceeds organization limit of %dMB", bytesToMB(*maxTenantBytes)))
		return
	}

	if quota := s.effectiveQuota(policy); quota > 0 && currentUsage+written > quota {
		_ = os.Remove(targetPath)
		app.ErrorJSON(w, http.StatusRequestEntityTooLarge, quotaExceededMessage(currentUsage, quota))
		return
	}

	files, err := s.ListFiles(claims.UserID)
	if err != nil {
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusCreated, files)
}

func (s Service) HandleDelete(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	if err := s.DeleteFile(claims.UserID, strings.TrimSpace(r.PathValue("name"))); err != nil {
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	app.WriteJSON(w, http.StatusOK, map[string]any{"deleted": true})
}

func (s Service) ListFiles(userID string) ([]FileInfo, error) {
	dirPath := s.userDrivePath(userID)
	entries, err := os.ReadDir(dirPath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return []FileInfo{}, nil
		}
		return nil, fmt.Errorf("list drive files: %w", err)
	}

	files := make([]FileInfo, 0, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return nil, fmt.Errorf("stat drive file: %w", err)
		}
		files = append(files, FileInfo{
			Name:       entry.Name(),
			Size:       info.Size(),
			ModifiedAt: info.ModTime().UTC().Format(time.RFC3339Nano),
		})
	}

	sort.Slice(files, func(i, j int) bool {
		return files[i].Name < files[j].Name
	})

	return files, nil
}

func (s Service) DeleteFile(userID, fileName string) error {
	filePath, err := s.getFilePath(userID, fileName)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &requestError{status: http.StatusNotFound, message: "File not found"}
		}
		return fmt.Errorf("delete drive file: %w", err)
	}
	return nil
}

func (s Service) loadTenantPolicy(ctx context.Context, tenantID string) (tenantFilePolicy, error) {
	if tenantID == "" || s.DB == nil {
		return tenantFilePolicy{}, nil
	}

	row := s.DB.QueryRow(ctx, `
SELECT
  "dlpDisableDownload",
  "dlpDisableUpload",
  "fileUploadMaxSizeBytes",
  "userDriveQuotaBytes"
FROM "Tenant"
WHERE id = $1
`, tenantID)

	var (
		policy             tenantFilePolicy
		fileUploadMaxBytes sql.NullInt32
		userDriveQuota     sql.NullInt32
	)
	if err := row.Scan(&policy.DLPDisableDownload, &policy.DLPDisableUpload, &fileUploadMaxBytes, &userDriveQuota); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return tenantFilePolicy{}, nil
		}
		return tenantFilePolicy{}, fmt.Errorf("load tenant file policy: %w", err)
	}
	if fileUploadMaxBytes.Valid {
		value := int64(fileUploadMaxBytes.Int32)
		policy.FileUploadMaxBytes = &value
	}
	if userDriveQuota.Valid {
		value := int64(userDriveQuota.Int32)
		policy.UserDriveQuota = &value
	}
	return policy, nil
}

func (s Service) currentUsage(userID string) (int64, error) {
	files, err := s.ListFiles(userID)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, file := range files {
		total += file.Size
	}
	return total, nil
}

func (s Service) getFilePath(userID, fileName string) (string, error) {
	sanitized := strings.TrimSpace(fileName)
	if sanitized == "" || len(sanitized) > maxFileNameLength {
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid file name"}
	}
	if strings.ContainsAny(sanitized, `/\`) || filepath.Base(sanitized) != sanitized {
		return "", &requestError{status: http.StatusBadRequest, message: "Invalid file name"}
	}
	filePath := filepath.Join(s.userDrivePath(userID), sanitized)
	if _, err := os.Stat(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", &requestError{status: http.StatusNotFound, message: "File not found"}
		}
		return "", fmt.Errorf("stat drive file: %w", err)
	}
	return filePath, nil
}

func (s Service) ensureUserDrive(userID string) (string, error) {
	dirPath := s.userDrivePath(userID)
	if err := os.MkdirAll(dirPath, 0o755); err != nil {
		return "", fmt.Errorf("create user drive: %w", err)
	}
	return dirPath, nil
}

func (s Service) userDrivePath(userID string) string {
	basePath := s.DriveBasePath
	if strings.TrimSpace(basePath) == "" {
		basePath = defaultDriveBasePath
	}
	return filepath.Join(basePath, sanitizeUserID(userID))
}

func (s Service) maxUploadBytes() int64 {
	if s.FileUploadMaxSize > 0 {
		return s.FileUploadMaxSize
	}
	return defaultMaxUploadBytes
}

func (s Service) effectiveQuota(policy tenantFilePolicy) int64 {
	if policy.UserDriveQuota != nil {
		return *policy.UserDriveQuota
	}
	if s.UserDriveQuota > 0 {
		return s.UserDriveQuota
	}
	return defaultUserQuotaBytes
}

func sanitizeUserID(userID string) string {
	safe := unsafeUserIDPattern.ReplaceAllString(userID, "")
	if safe == "" {
		return "unknown"
	}
	return safe
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

func quotaExceededMessage(currentUsage, quota int64) string {
	return fmt.Sprintf(
		"Drive quota exceeded. Current usage: %dMB, limit: %dMB",
		bytesToMB(currentUsage),
		bytesToMB(quota),
	)
}

func bytesToMB(value int64) int64 {
	if value <= 0 {
		return 0
	}
	return value / 1024 / 1024
}

func max(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
