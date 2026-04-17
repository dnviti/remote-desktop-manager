package files

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"os"
	pathpkg "path"
	"sort"
	"strings"
	"time"
)

type recordedPut struct {
	key         string
	payload     []byte
	contentType string
	metadata    map[string]string
}

type recordingObjectStore struct {
	delegate           ObjectStore
	ensureBucketCalls  int
	puts               []recordedPut
	ensureBucketErr    error
	putErr             error
	getKeys            []string
	getPayloadOverride []byte
	getErr             error
	deleteErr          error
	deletedKeys        []string
	listErr            error
	statErr            error
}

func newRecordingObjectStore() *recordingObjectStore {
	return &recordingObjectStore{delegate: NewMemoryObjectStore()}
}

func (s *recordingObjectStore) EnsureBucket(context.Context) error {
	s.ensureBucketCalls++
	return s.ensureBucketErr
}

func (s *recordingObjectStore) Put(ctx context.Context, key string, payload []byte, contentType string, metadata map[string]string) (ObjectInfo, error) {
	s.puts = append(s.puts, recordedPut{
		key:         key,
		payload:     append([]byte(nil), payload...),
		contentType: contentType,
		metadata:    cloneStringMap(metadata),
	})
	if s.putErr != nil {
		return ObjectInfo{}, s.putErr
	}
	return s.delegate.Put(ctx, key, payload, contentType, metadata)
}

func (s *recordingObjectStore) Get(ctx context.Context, key string) (io.ReadCloser, ObjectInfo, error) {
	s.getKeys = append(s.getKeys, key)
	if s.getErr != nil {
		return nil, ObjectInfo{}, s.getErr
	}
	if s.getPayloadOverride != nil {
		return io.NopCloser(bytes.NewReader(s.getPayloadOverride)), ObjectInfo{
			Key:         key,
			Size:        int64(len(s.getPayloadOverride)),
			ContentType: http.DetectContentType(s.getPayloadOverride),
		}, nil
	}
	return s.delegate.Get(ctx, key)
}

func (s *recordingObjectStore) Delete(ctx context.Context, key string) error {
	s.deletedKeys = append(s.deletedKeys, key)
	if s.deleteErr != nil {
		return s.deleteErr
	}
	return s.delegate.Delete(ctx, key)
}

func (s *recordingObjectStore) List(ctx context.Context, prefix string) ([]ObjectInfo, error) {
	if s.listErr != nil {
		return nil, s.listErr
	}
	return s.delegate.List(ctx, prefix)
}

func (s *recordingObjectStore) Stat(ctx context.Context, key string) (ObjectInfo, error) {
	if s.statErr != nil {
		return ObjectInfo{}, s.statErr
	}
	return s.delegate.Stat(ctx, key)
}

type recordedScan struct {
	fileName string
	payload  []byte
}

type recordingThreatScanner struct {
	verdict ScanVerdict
	err     error
	scans   []recordedScan
}

func (s *recordingThreatScanner) Scan(_ context.Context, fileName string, payload []byte) (ScanVerdict, error) {
	s.scans = append(s.scans, recordedScan{fileName: fileName, payload: append([]byte(nil), payload...)})
	if s.err != nil {
		return ScanVerdict{}, s.err
	}
	if s.verdict == (ScanVerdict{}) {
		return ScanVerdict{Clean: true}, nil
	}
	return s.verdict, nil
}

type renameCall struct {
	oldPath string
	newPath string
}

type fakeSSHRemoteEntry struct {
	isDir   bool
	payload []byte
	modTime time.Time
}

type fakeSSHRemoteClient struct {
	workingDir           string
	fs                   map[string]fakeSSHRemoteEntry
	readDirPaths         []string
	readDirEntries       []os.FileInfo
	readDirErr           error
	mkdirPaths           []string
	mkdirErr             error
	mkdirHook            func(path string) error
	statPaths            []string
	statInfo             os.FileInfo
	statErr              error
	removeDirectoryPaths []string
	removeDirectoryErr   error
	removePaths          []string
	removeErr            error
	removeHook           func(path string) error
	renameCalls          []renameCall
	renameErr            error
	renameHook           func(oldPath, newPath string) error
	createPaths          []string
	createErr            error
	createWriteErr       error
	createCloseErr       error
	createBuffer         bytes.Buffer
	openPaths            []string
	openErr              error
	openPayload          []byte
}

func (c *fakeSSHRemoteClient) Getwd() (string, error) {
	if strings.TrimSpace(c.workingDir) == "" {
		c.workingDir = "/home/test"
	}
	c.ensureBaseFS()
	return c.workingDir, nil
}

func (c *fakeSSHRemoteClient) ReadDir(path string) ([]os.FileInfo, error) {
	c.readDirPaths = append(c.readDirPaths, path)
	if c.readDirErr != nil {
		return nil, c.readDirErr
	}
	if c.readDirEntries != nil {
		return append([]os.FileInfo(nil), c.readDirEntries...), nil
	}
	c.ensureBaseFS()
	cleanPath := normalizeFakeSSHPath(path)
	children := map[string]os.FileInfo{}
	prefix := cleanPath
	if prefix != "/" {
		prefix += "/"
	}
	for itemPath, entry := range c.fs {
		if itemPath == cleanPath || !strings.HasPrefix(itemPath, prefix) {
			continue
		}
		remainder := strings.TrimPrefix(itemPath, prefix)
		name, _, _ := strings.Cut(remainder, "/")
		if name == "" {
			continue
		}
		childPath := pathpkg.Join(cleanPath, name)
		if childEntry, ok := c.fs[childPath]; ok {
			children[name] = fakeFileInfo{name: name, size: int64(len(childEntry.payload)), mode: fakeSSHEntryMode(childEntry.isDir), modTime: childEntry.modTime}
			continue
		}
		children[name] = fakeFileInfo{name: name, mode: os.ModeDir, modTime: entry.modTime}
	}
	items := make([]os.FileInfo, 0, len(children))
	for _, info := range children {
		items = append(items, info)
	}
	sort.Slice(items, func(i, j int) bool { return items[i].Name() < items[j].Name() })
	return items, nil
}

func (c *fakeSSHRemoteClient) Mkdir(path string) error {
	c.mkdirPaths = append(c.mkdirPaths, path)
	if c.mkdirHook != nil {
		if err := c.mkdirHook(path); err != nil {
			return err
		}
	}
	if c.mkdirErr != nil {
		return c.mkdirErr
	}
	c.ensureBaseFS()
	c.ensureDir(path)
	return nil
}

func (c *fakeSSHRemoteClient) Stat(path string) (os.FileInfo, error) {
	c.statPaths = append(c.statPaths, path)
	if c.statErr != nil {
		return nil, c.statErr
	}
	if c.statInfo != nil {
		return c.statInfo, nil
	}
	c.ensureBaseFS()
	entry, ok := c.fs[normalizeFakeSSHPath(path)]
	if !ok {
		return nil, os.ErrNotExist
	}
	return fakeFileInfo{name: pathpkg.Base(normalizeFakeSSHPath(path)), size: int64(len(entry.payload)), mode: fakeSSHEntryMode(entry.isDir), modTime: entry.modTime}, nil
}

func (c *fakeSSHRemoteClient) RemoveDirectory(path string) error {
	c.removeDirectoryPaths = append(c.removeDirectoryPaths, path)
	if c.removeHook != nil {
		if err := c.removeHook(path); err != nil {
			return err
		}
	}
	if c.removeDirectoryErr != nil {
		return c.removeDirectoryErr
	}
	c.ensureBaseFS()
	cleanPath := normalizeFakeSSHPath(path)
	for itemPath := range c.fs {
		if itemPath != cleanPath && strings.HasPrefix(itemPath, cleanPath+"/") {
			return fakeSSHError("directory not empty")
		}
	}
	delete(c.fs, cleanPath)
	return nil
}

func (c *fakeSSHRemoteClient) Remove(path string) error {
	c.removePaths = append(c.removePaths, path)
	if c.removeHook != nil {
		if err := c.removeHook(path); err != nil {
			return err
		}
	}
	if c.removeErr != nil {
		return c.removeErr
	}
	c.ensureBaseFS()
	delete(c.fs, normalizeFakeSSHPath(path))
	return nil
}

func (c *fakeSSHRemoteClient) Rename(oldPath, newPath string) error {
	c.renameCalls = append(c.renameCalls, renameCall{oldPath: oldPath, newPath: newPath})
	if c.renameHook != nil {
		if err := c.renameHook(oldPath, newPath); err != nil {
			return err
		}
	}
	if c.renameErr != nil {
		return c.renameErr
	}
	c.ensureBaseFS()
	oldClean := normalizeFakeSSHPath(oldPath)
	newClean := normalizeFakeSSHPath(newPath)
	c.ensureDir(pathpkg.Dir(newClean))
	updates := map[string]fakeSSHRemoteEntry{}
	for itemPath, entry := range c.fs {
		if itemPath != oldClean && !strings.HasPrefix(itemPath, oldClean+"/") {
			continue
		}
		remainder := strings.TrimPrefix(itemPath, oldClean)
		updates[newClean+remainder] = entry
		delete(c.fs, itemPath)
	}
	for itemPath, entry := range updates {
		c.fs[itemPath] = entry
	}
	return nil
}

func (c *fakeSSHRemoteClient) Create(path string) (io.WriteCloser, error) {
	c.createPaths = append(c.createPaths, path)
	if c.createErr != nil {
		return nil, c.createErr
	}
	c.ensureBaseFS()
	c.createBuffer.Reset()
	return &fakeSSHWriteCloser{buffer: &c.createBuffer, writeErr: c.createWriteErr, closeErr: c.createCloseErr, onClose: func(payload []byte) {
		cleanPath := normalizeFakeSSHPath(path)
		c.ensureDir(pathpkg.Dir(cleanPath))
		c.fs[cleanPath] = fakeSSHRemoteEntry{payload: append([]byte(nil), payload...), modTime: time.Now().UTC()}
	}}, nil
}

func (c *fakeSSHRemoteClient) Open(path string) (io.ReadCloser, error) {
	c.openPaths = append(c.openPaths, path)
	if c.openErr != nil {
		return nil, c.openErr
	}
	if c.openPayload != nil {
		return io.NopCloser(bytes.NewReader(c.openPayload)), nil
	}
	c.ensureBaseFS()
	entry, ok := c.fs[normalizeFakeSSHPath(path)]
	if !ok {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(entry.payload)), nil
}

type fakeSSHWriteCloser struct {
	buffer   *bytes.Buffer
	writeErr error
	closeErr error
	onClose  func([]byte)
}

func (w *fakeSSHWriteCloser) Write(payload []byte) (int, error) {
	if w.writeErr != nil {
		return 0, w.writeErr
	}
	return w.buffer.Write(payload)
}

func (w *fakeSSHWriteCloser) Close() error {
	if w.closeErr == nil && w.onClose != nil {
		w.onClose(w.buffer.Bytes())
	}
	return w.closeErr
}

func (c *fakeSSHRemoteClient) ensureBaseFS() {
	if c.fs == nil {
		c.fs = make(map[string]fakeSSHRemoteEntry)
	}
	if strings.TrimSpace(c.workingDir) == "" {
		c.workingDir = "/home/test"
	}
	c.ensureDir("/")
	c.ensureDir(c.workingDir)
}

func (c *fakeSSHRemoteClient) ensureDir(dirPath string) {
	if c.fs == nil {
		c.fs = make(map[string]fakeSSHRemoteEntry)
	}
	cleanPath := normalizeFakeSSHPath(dirPath)
	if cleanPath == "" || cleanPath == "." {
		cleanPath = "/"
	}
	if cleanPath != "/" {
		c.ensureDir(pathpkg.Dir(cleanPath))
	}
	entry := c.fs[cleanPath]
	entry.isDir = true
	if entry.modTime.IsZero() {
		entry.modTime = time.Now().UTC()
	}
	c.fs[cleanPath] = entry
}

func normalizeFakeSSHPath(value string) string {
	clean := pathpkg.Clean(value)
	if clean == "." || clean == "" {
		return "/"
	}
	return clean
}

func fakeSSHEntryMode(isDir bool) os.FileMode {
	if isDir {
		return os.ModeDir
	}
	return 0
}

type fakeSSHError string

func (e fakeSSHError) Error() string { return string(e) }

type fakeFileInfo struct {
	name    string
	size    int64
	mode    os.FileMode
	modTime time.Time
}

func (f fakeFileInfo) Name() string       { return f.name }
func (f fakeFileInfo) Size() int64        { return f.size }
func (f fakeFileInfo) Mode() os.FileMode  { return f.mode }
func (f fakeFileInfo) ModTime() time.Time { return f.modTime }
func (f fakeFileInfo) IsDir() bool        { return f.mode.IsDir() }
func (f fakeFileInfo) Sys() any           { return nil }
