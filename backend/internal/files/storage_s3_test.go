package files

import (
	"context"
	"errors"
	"testing"
)

func TestLoadObjectStoreFromEnvRequiresBucket(t *testing.T) {
	t.Setenv("SHARED_FILES_S3_BUCKET", "")
	t.Setenv("SHARED_FILES_S3_REGION", "")
	t.Setenv("SHARED_FILES_S3_ENDPOINT", "")
	t.Setenv("SHARED_FILES_S3_ACCESS_KEY_ID", "")
	t.Setenv("SHARED_FILES_S3_SECRET_ACCESS_KEY", "")
	t.Setenv("SHARED_FILES_S3_PREFIX", "")
	t.Setenv("SHARED_FILES_S3_FORCE_PATH_STYLE", "")
	t.Setenv("SHARED_FILES_S3_AUTO_CREATE_BUCKET", "")

	_, err := LoadObjectStoreFromEnv(context.Background())
	if !errors.Is(err, ErrSharedFilesS3NotConfigured) {
		t.Fatalf("expected ErrSharedFilesS3NotConfigured, got %v", err)
	}
}
