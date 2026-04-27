package files

import (
	"context"
	"io"
	"log/slog"
	"regexp"
	"time"

	"github.com/dnviti/arsenale/backend/internal/connectionaccess"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	defaultDriveBasePath  = "/guacd-drive"
	defaultMaxUploadBytes = 100 * 1024 * 1024
	defaultUserQuotaBytes = 100 * 1024 * 1024
	multipartOverhead     = 1024 * 1024
	maxFileNameLength     = 255
)

var unsafeUserIDPattern = regexp.MustCompile(`[^a-zA-Z0-9-]`)
var unsafeUploadNamePattern = regexp.MustCompile(`[^a-zA-Z0-9._-]`)
var unsafeDisplayPathPattern = regexp.MustCompile(`[^a-zA-Z0-9]+`)

type Service struct {
	DB                 *pgxpool.Pool
	DriveBasePath      string
	FileUploadMaxSize  int64
	UserDriveQuota     int64
	ConnectionResolver connectionaccess.FileResolver
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
	DisableDownload         bool
	DisableUpload           bool
	RetainSuccessfulUploads bool
	FileUploadMax           *int64
	UserDriveQuota          *int64
}

type dlpPolicy struct {
	DisableDownload bool `json:"disableDownload"`
	DisableUpload   bool `json:"disableUpload"`
}

type managedFileOperationClass string

const (
	managedFileOperationClassPayload  managedFileOperationClass = "payload"
	managedFileOperationClassMetadata managedFileOperationClass = "metadata"
)

type managedFileOperation string

const (
	managedFileOperationUpload   managedFileOperation = "upload"
	managedFileOperationDownload managedFileOperation = "download"
	managedFileOperationList     managedFileOperation = "list"
	managedFileOperationMkdir    managedFileOperation = "mkdir"
	managedFileOperationDelete   managedFileOperation = "delete"
	managedFileOperationRename   managedFileOperation = "rename"
)

type managedFileOperationContract struct {
	Operation                managedFileOperation
	Class                    managedFileOperationClass
	ManagedViaREST           bool
	AllowsDirectClientSFTP   bool
	RequiresObjectStore      bool
	RequiresThreatScan       bool
	RequiresAuditLog         bool
	RequiresAuditCorrelation bool
}

type managedFileDependencies struct {
	Store   ObjectStore
	Scanner ThreatScanner
}

type managedPayloadStageRequest struct {
	StagePrefix string
	FileName    string
	Payload     []byte
	Metadata    map[string]string
}

type managedRemotePayload struct {
	FileName string
	Payload  []byte
	Metadata map[string]string
}

type managedPayloadResult struct {
	Contract           managedFileOperationContract
	AuditCorrelationID string
	StageKey           string
	FileName           string
	Payload            []byte
	Metadata           map[string]string
	Object             ObjectInfo
}

type ManagedHistoryEntry struct {
	ID             string            `json:"id"`
	FileName       string            `json:"fileName"`
	RestoredName   string            `json:"restoredName,omitempty"`
	Size           int64             `json:"size"`
	ContentType    string            `json:"contentType,omitempty"`
	TransferAt     string            `json:"transferAt"`
	ActorID        string            `json:"actorId,omitempty"`
	Protocol       string            `json:"protocol"`
	TransferID     string            `json:"transferId,omitempty"`
	ChecksumSHA256 string            `json:"checksumSha256,omitempty"`
	PolicyDecision string            `json:"policyDecision,omitempty"`
	ScanResult     string            `json:"scanResult,omitempty"`
	ObjectKey      string            `json:"-"`
	Metadata       map[string]string `json:"-"`
	ModifiedAt     time.Time         `json:"-"`
}

type managedHistoryRetentionOptions struct {
	Protocol string
	ActorID  string
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
