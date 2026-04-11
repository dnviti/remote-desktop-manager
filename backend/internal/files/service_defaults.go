package files

import (
	"context"
	"log/slog"
	"strings"
)

func (s Service) objectStore() ObjectStore {
	if s.Store != nil {
		return s.Store
	}
	return NewMemoryObjectStore()
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
		return err
	}
	return nil
}

func isObjectNotFound(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "not found")
}
