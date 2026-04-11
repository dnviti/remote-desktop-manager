package files

import (
	"bytes"
	"context"
	"errors"
	"io"
	"sort"
	"strings"
	"sync"
	"time"
)

type memoryObjectStore struct {
	mu      sync.RWMutex
	objects map[string]memoryObject
}

type memoryObject struct {
	payload     []byte
	contentType string
	metadata    map[string]string
	modifiedAt  time.Time
}

func NewMemoryObjectStore() ObjectStore {
	return &memoryObjectStore{objects: make(map[string]memoryObject)}
}

func (s *memoryObjectStore) EnsureBucket(context.Context) error {
	return nil
}

func (s *memoryObjectStore) Put(_ context.Context, key string, payload []byte, contentType string, metadata map[string]string) (ObjectInfo, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	stored := append([]byte(nil), payload...)
	info := memoryObject{
		payload:     stored,
		contentType: contentType,
		metadata:    cloneStringMap(metadata),
		modifiedAt:  time.Now().UTC(),
	}
	s.objects[key] = info
	return ObjectInfo{
		Key:         key,
		Size:        int64(len(stored)),
		ModifiedAt:  info.modifiedAt,
		ContentType: contentType,
		Metadata:    cloneStringMap(metadata),
	}, nil
}

func (s *memoryObjectStore) Get(_ context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	item, ok := s.objects[key]
	if !ok {
		return nil, ObjectInfo{}, errors.New("object not found")
	}
	reader := io.NopCloser(bytes.NewReader(item.payload))
	return reader, ObjectInfo{
		Key:         key,
		Size:        int64(len(item.payload)),
		ModifiedAt:  item.modifiedAt,
		ContentType: item.contentType,
		Metadata:    cloneStringMap(item.metadata),
	}, nil
}

func (s *memoryObjectStore) Delete(_ context.Context, key string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.objects, key)
	return nil
}

func (s *memoryObjectStore) List(_ context.Context, prefix string) ([]ObjectInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	items := make([]ObjectInfo, 0)
	for key, value := range s.objects {
		if prefix != "" && !strings.HasPrefix(key, prefix) {
			continue
		}
		items = append(items, ObjectInfo{
			Key:         key,
			Size:        int64(len(value.payload)),
			ModifiedAt:  value.modifiedAt,
			ContentType: value.contentType,
			Metadata:    cloneStringMap(value.metadata),
		})
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Key < items[j].Key })
	return items, nil
}

func (s *memoryObjectStore) Stat(_ context.Context, key string) (ObjectInfo, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	item, ok := s.objects[key]
	if !ok {
		return ObjectInfo{}, errors.New("object not found")
	}
	return ObjectInfo{
		Key:         key,
		Size:        int64(len(item.payload)),
		ModifiedAt:  item.modifiedAt,
		ContentType: item.contentType,
		Metadata:    cloneStringMap(item.metadata),
	}, nil
}

func cloneStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return map[string]string{}
	}
	out := make(map[string]string, len(input))
	for key, value := range input {
		out[key] = value
	}
	return out
}
