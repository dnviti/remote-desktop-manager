package files

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"strings"
)

var ErrSharedFilesStorageUnavailable = errors.New("shared file object storage is unavailable")

type unavailableObjectStore struct {
	cause error
}

type sharedFilesStorageUnavailableError struct {
	cause error
}

func (e *sharedFilesStorageUnavailableError) Error() string {
	return ErrSharedFilesStorageUnavailable.Error()
}

func (e *sharedFilesStorageUnavailableError) Unwrap() error {
	if e.cause != nil {
		return e.cause
	}
	return ErrSharedFilesStorageUnavailable
}

func (e *sharedFilesStorageUnavailableError) Is(target error) bool {
	return target == ErrSharedFilesStorageUnavailable || errors.Is(e.cause, target)
}

func newSharedFilesStorageUnavailableError(cause error) error {
	if cause == nil {
		return ErrSharedFilesStorageUnavailable
	}
	if errors.Is(cause, ErrSharedFilesStorageUnavailable) {
		return cause
	}
	var unavailable *sharedFilesStorageUnavailableError
	if errors.As(cause, &unavailable) {
		return cause
	}
	return &sharedFilesStorageUnavailableError{cause: cause}
}

func (s unavailableObjectStore) err() error {
	return newSharedFilesStorageUnavailableError(s.cause)
}

func (s unavailableObjectStore) EnsureBucket(context.Context) error {
	return s.err()
}

func (s unavailableObjectStore) Put(context.Context, string, []byte, string, map[string]string) (ObjectInfo, error) {
	return ObjectInfo{}, s.err()
}

func (s unavailableObjectStore) Get(context.Context, string) (io.ReadCloser, ObjectInfo, error) {
	return nil, ObjectInfo{}, s.err()
}

func (s unavailableObjectStore) Delete(context.Context, string) error {
	return s.err()
}

func (s unavailableObjectStore) List(context.Context, string) ([]ObjectInfo, error) {
	return nil, s.err()
}

func (s unavailableObjectStore) Stat(context.Context, string) (ObjectInfo, error) {
	return ObjectInfo{}, s.err()
}

func (s Service) objectStore() ObjectStore {
	if s.Store != nil {
		return s.Store
	}
	return unavailableObjectStore{cause: ErrSharedFilesS3NotConfigured}
}

func (s Service) scanner() ThreatScanner {
	if s.Scanner != nil {
		return s.Scanner
	}
	return builtinThreatScanner{}
}

func (s Service) logger() *slog.Logger {
	if s.Logger != nil {
		return s.Logger
	}
	return slog.Default()
}

func (s Service) ensureReady(ctx context.Context) error {
	if err := s.objectStore().EnsureBucket(ctx); err != nil {
		s.logger().Warn("shared file object storage unavailable", "error", err)
		return newSharedFilesStorageUnavailableError(err)
	}
	return nil
}

func isObjectNotFound(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "not found")
}
