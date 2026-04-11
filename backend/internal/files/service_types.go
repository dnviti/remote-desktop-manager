package files

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"time"

	"github.com/dnviti/arsenale/backend/internal/sshsessions"
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
	DB                 *pgxpool.Pool
	DriveBasePath      string
	FileUploadMaxSize  int64
	UserDriveQuota     int64
	ConnectionResolver sshsessions.Service
	Store              ObjectStore
	Scanner            ThreatScanner
	Logger             *slog.Logger
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

type RemoteEntry struct {
	Name       string `json:"name"`
	Size       int64  `json:"size"`
	Type       string `json:"type"`
	ModifiedAt string `json:"modifiedAt"`
}

type tenantFilePolicy struct {
	DLPDisableDownload bool
	DLPDisableUpload   bool
	FileUploadMaxBytes *int64
	UserDriveQuota     *int64
}

type resolvedFilePolicy struct {
	DisableDownload bool
	DisableUpload   bool
	FileUploadMax   *int64
	UserDriveQuota  *int64
}

type dlpPolicy struct {
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type ObjectStore interface {
	EnsureBucket(ctx context.Context) error
	Put(ctx context.Context, key string, payload []byte, contentType string, metadata map[string]string) (ObjectInfo, error)
	Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error)
	Delete(ctx context.Context, key string) error
	List(ctx context.Context, prefix string) ([]ObjectInfo, error)
	Stat(ctx context.Context, key string) (ObjectInfo, error)
}

type ObjectInfo struct {
	Key         string
	Size        int64
	ModifiedAt  time.Time
	ContentType string
	Metadata    map[string]string
}

type ThreatScanner interface {
	Scan(ctx context.Context, filename string, payload []byte) (ScanVerdict, error)
}

type ScanVerdict struct {
	Clean     bool
	Reason    string
	Signature string
}
