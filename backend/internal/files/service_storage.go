package files

import (
	"errors"
	"fmt"
	"os"
	"sort"
	"time"
)

func (s Service) ListFiles(tenantID, userID, connectionID string) ([]FileInfo, error) {
	dirPath := s.userDrivePath(tenantID, userID, connectionID)
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

func (s Service) DeleteFile(tenantID, userID, connectionID, fileName string) error {
	filePath, err := s.getFilePath(tenantID, userID, connectionID, fileName)
	if err != nil {
		return err
	}
	if err := os.Remove(filePath); err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return &requestError{status: 404, message: "File not found"}
		}
		return fmt.Errorf("delete drive file: %w", err)
	}
	return nil
}

func (s Service) currentUsage(tenantID, userID, connectionID string) (int64, error) {
	files, err := s.ListFiles(tenantID, userID, connectionID)
	if err != nil {
		return 0, err
	}
	var total int64
	for _, file := range files {
		total += file.Size
	}
	return total, nil
}
