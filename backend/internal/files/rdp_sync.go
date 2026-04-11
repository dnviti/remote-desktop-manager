package files

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"time"
)

func (s Service) syncDriveToStage(ctx context.Context, drivePath, prefix string) error {
	entries, err := os.ReadDir(drivePath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("list drive files: %w", err)
	}

	localFiles := make(map[string]struct{}, len(entries))
	for _, entry := range entries {
		if !entry.Type().IsRegular() {
			continue
		}
		localFiles[entry.Name()] = struct{}{}
		info, err := entry.Info()
		if err != nil {
			return fmt.Errorf("stat drive file: %w", err)
		}
		key := stageObjectKey(prefix, entry.Name())
		stat, err := s.objectStore().Stat(ctx, key)
		if err == nil && stat.Size == info.Size() && stat.ModifiedAt.Unix() == info.ModTime().UTC().Unix() {
			continue
		}
		if err := s.stageLocalFile(ctx, filepath.Join(drivePath, entry.Name()), entry.Name(), key, info.ModTime().UTC()); err != nil {
			if reqErr, ok := err.(*requestError); ok && reqErr.status == http.StatusUnprocessableEntity {
				s.logger().Warn("blocked remote drive file during import", "file", entry.Name(), "reason", reqErr.message)
				continue
			}
			return err
		}
	}

	staged, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("list staged files: %w", err)
	}
	for _, item := range staged {
		name := decodeObjectName(filepath.Base(item.Key))
		if _, exists := localFiles[name]; exists {
			continue
		}
		if err := s.objectStore().Delete(ctx, item.Key); err != nil {
			return fmt.Errorf("delete staged file: %w", err)
		}
	}
	return nil
}

func (s Service) materializeStageToDrive(ctx context.Context, drivePath, prefix string) error {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return fmt.Errorf("list staged files: %w", err)
	}
	for _, item := range objects {
		name := decodeObjectName(filepath.Base(item.Key))
		targetPath := filepath.Join(drivePath, name)
		currentInfo, err := os.Stat(targetPath)
		if err == nil && currentInfo.Size() == item.Size && currentInfo.ModTime().UTC().Unix() >= item.ModifiedAt.UTC().Unix() {
			continue
		}
		if err := s.materializeObject(ctx, item.Key, targetPath, item.ModifiedAt.UTC()); err != nil {
			return err
		}
	}
	return nil
}

func (s Service) stageLocalFile(ctx context.Context, path, fileName, key string, modifiedAt time.Time) error {
	payload, err := os.ReadFile(path)
	if err != nil {
		return fmt.Errorf("read local drive file: %w", err)
	}
	verdict, err := s.scanner().Scan(ctx, fileName, payload)
	if err != nil {
		return fmt.Errorf("scan drive file: %w", err)
	}
	if !verdict.Clean {
		return &requestError{status: http.StatusUnprocessableEntity, message: firstNonEmpty(verdict.Reason, "file blocked by threat scanner")}
	}
	_, err = s.objectStore().Put(ctx, key, payload, http.DetectContentType(payload), map[string]string{
		"mtime-unix": fmt.Sprintf("%d", modifiedAt.Unix()),
	})
	if err != nil {
		return fmt.Errorf("stage drive file: %w", err)
	}
	return nil
}

func (s Service) materializeObject(ctx context.Context, key, targetPath string, modifiedAt time.Time) error {
	reader, _, err := s.objectStore().Get(ctx, key)
	if err != nil {
		return fmt.Errorf("read staged file: %w", err)
	}
	defer reader.Close()

	payload, err := io.ReadAll(reader)
	if err != nil {
		return fmt.Errorf("read staged payload: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(targetPath), 0o755); err != nil {
		return fmt.Errorf("create drive directory: %w", err)
	}
	if err := os.WriteFile(targetPath, payload, 0o644); err != nil {
		return fmt.Errorf("write drive file: %w", err)
	}
	_ = os.Chtimes(targetPath, modifiedAt, modifiedAt)
	return nil
}

func (s Service) listStagedFiles(ctx context.Context, prefix string) ([]FileInfo, error) {
	objects, err := s.objectStore().List(ctx, prefix)
	if err != nil {
		return nil, err
	}
	files := make([]FileInfo, 0, len(objects))
	for _, item := range objects {
		files = append(files, FileInfo{
			Name:       decodeObjectName(filepath.Base(item.Key)),
			Size:       item.Size,
			ModifiedAt: item.ModifiedAt.UTC().Format(time.RFC3339Nano),
		})
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Name < files[j].Name })
	return files, nil
}
