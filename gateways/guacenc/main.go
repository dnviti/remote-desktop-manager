package main

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	defaultPort              = 3003
	defaultAllowedPrefix     = "/recordings/"
	defaultGUACENCTimeout    = 300 * time.Second
	defaultJobExpiry         = time.Hour
	defaultMaxConcurrentJobs = 4
	defaultAsciicastTimeout  = 300 * time.Second
	defaultAggFontSize       = 14
	defaultAggTheme          = "monokai"
	defaultCleanupMaxAgeDays = 90
	maxCommandOutputBytes    = 16 * 1024
)

type config struct {
	port             int
	allowedPrefix    string
	guacencTimeout   time.Duration
	jobExpiry        time.Duration
	maxConcurrent    int
	asciicastTimeout time.Duration
	aggFontSize      int
	aggTheme         string
	tlsCert          string
	tlsKey           string
	cachePubSubURL   string
	cacheTLSCA       string
	cacheTLSCert     string
	cacheTLSKey      string
}

type tokenStore struct {
	mu    sync.RWMutex
	value string
}

func (t *tokenStore) Get() string {
	t.mu.RLock()
	defer t.mu.RUnlock()
	return t.value
}

func (t *tokenStore) Set(value string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.value = value
}

type server struct {
	cfg       config
	jobs      *jobStore
	tokens    *tokenStore
	startTime time.Time
}

type errTooManyActiveJobs struct {
	active int
}

func (e errTooManyActiveJobs) Error() string {
	return fmt.Sprintf("too many active conversions (%d)", e.active)
}

type convertRequest struct {
	FilePath string `json:"filePath"`
	Width    int    `json:"width"`
	Height   int    `json:"height"`
}

type convertAsciicastRequest struct {
	FilePath string `json:"filePath"`
}

type cacheDeleteRequest struct {
	FilePath string `json:"filePath"`
}

type cleanupRequest struct {
	MaxAgeDays *int `json:"maxAgeDays"`
}

func main() {
	log.SetFlags(0)
	log.SetPrefix("[guacenc] ")

	cfg := loadConfig()
	tokens := &tokenStore{value: readSecret("guacenc_auth_token", "GUACENC_AUTH_TOKEN", "")}
	svc := &server{
		cfg:       cfg,
		jobs:      newJobStore(cfg.jobExpiry, cfg.maxConcurrent),
		tokens:    tokens,
		startTime: time.Now(),
	}

	rootCtx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	startGocacheSubscriber(rootCtx, cfg, tokens)
	log.Printf("Bearer auth: %s", enabledDisabled(tokens.Get() != ""))
	log.Printf("Listening on port %d", cfg.port)
	log.Printf("Max concurrent jobs: %d", cfg.maxConcurrent)
	log.Printf("Conversion timeout: %s", cfg.guacencTimeout)
	log.Printf("Job expiry: %s", cfg.jobExpiry)

	mux := http.NewServeMux()
	mux.HandleFunc("/health", svc.handleHealth)
	mux.HandleFunc("/conversions", svc.requireAuth(svc.handleListConversions))
	mux.HandleFunc("/status/", svc.requireAuth(svc.handleStatus))
	mux.HandleFunc("/convert", svc.requireAuth(svc.handleConvert))
	mux.HandleFunc("/convert-asciicast", svc.requireAuth(svc.handleConvertAsciicast))
	mux.HandleFunc("/cleanup", svc.requireAuth(svc.handleCleanup))
	mux.HandleFunc("/cache", svc.requireAuth(svc.handleDeleteCache))
	mux.HandleFunc("/", notFound)

	httpServer := &http.Server{
		Addr:              fmt.Sprintf("0.0.0.0:%d", cfg.port),
		Handler:           mux,
		ReadHeaderTimeout: 10 * time.Second,
	}

	go func() {
		<-rootCtx.Done()
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		_ = httpServer.Shutdown(ctx)
	}()

	var err error
	if cfg.tlsCert != "" && cfg.tlsKey != "" {
		httpServer.TLSConfig = &tls.Config{MinVersion: tls.VersionTLS12}
		log.Printf("TLS enabled (cert=%s)", cfg.tlsCert)
		err = httpServer.ListenAndServeTLS(cfg.tlsCert, cfg.tlsKey)
	} else {
		log.Printf("WARNING: Running without TLS")
		err = httpServer.ListenAndServe()
	}

	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatalf("server failed: %v", err)
	}
}

func loadConfig() config {
	return config{
		port:             envInt("PORT", defaultPort),
		allowedPrefix:    envString("ALLOWED_PREFIX", defaultAllowedPrefix),
		guacencTimeout:   envDurationSeconds("GUACENC_TIMEOUT", defaultGUACENCTimeout),
		jobExpiry:        envDurationSeconds("JOB_EXPIRY_SECONDS", defaultJobExpiry),
		maxConcurrent:    envInt("MAX_CONCURRENT_JOBS", defaultMaxConcurrentJobs),
		asciicastTimeout: envDurationSeconds("ASCIICAST_TIMEOUT", defaultAsciicastTimeout),
		aggFontSize:      envInt("AGG_FONT_SIZE", defaultAggFontSize),
		aggTheme:         envString("AGG_THEME", defaultAggTheme),
		tlsCert:          strings.TrimSpace(os.Getenv("GUACENC_TLS_CERT")),
		tlsKey:           strings.TrimSpace(os.Getenv("GUACENC_TLS_KEY")),
		cachePubSubURL:   firstNonEmptyEnv("CACHE_PUBSUB_URL", "CACHE_SIDECAR_URL"),
		cacheTLSCA:       firstNonEmptyEnv("CACHE_PUBSUB_TLS_CA", "CACHE_SIDECAR_TLS_CA"),
		cacheTLSCert:     firstNonEmptyEnv("CACHE_PUBSUB_TLS_CERT", "CACHE_SIDECAR_TLS_CERT"),
		cacheTLSKey:      firstNonEmptyEnv("CACHE_PUBSUB_TLS_KEY", "CACHE_SIDECAR_TLS_KEY"),
	}
}

func (s *server) requireAuth(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !s.checkAuth(w, r) {
			return
		}
		next(w, r)
	}
}

func (s *server) checkAuth(w http.ResponseWriter, r *http.Request) bool {
	secret := s.tokens.Get()
	if secret == "" {
		return true
	}

	authHeader := r.Header.Get("Authorization")
	if !strings.HasPrefix(authHeader, "Bearer ") {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "authorization required"})
		return false
	}

	token := strings.TrimPrefix(authHeader, "Bearer ")
	if subtle.ConstantTimeCompare([]byte(token), []byte(secret)) != 1 {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "invalid token"})
		return false
	}
	return true
}

func (s *server) handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status":             "ok",
		"uptime":             roundDurationSeconds(time.Since(s.startTime)),
		"activeJobs":         s.jobs.activeCount(),
		"totalJobsProcessed": s.jobs.total(),
	})
}

func (s *server) handleConvert(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var req convertRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.validateRecordingFile(w, req.FilePath) {
		return
	}

	width := req.Width
	if width <= 0 {
		width = 1024
	}
	height := req.Height
	if height <= 0 {
		height = 768
	}

	job, err := s.jobs.create(req.FilePath, fmt.Sprintf("%dx%d", width, height))
	if err != nil {
		s.writeTooManyActiveJobs(w, err)
		return
	}

	go s.runGuacConversion(job.JobID, req.FilePath, width, height)
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": job.JobID, "status": "pending"})
}

func (s *server) handleConvertAsciicast(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var req convertAsciicastRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !s.validateRecordingFile(w, req.FilePath) {
		return
	}

	job, err := s.jobs.create(req.FilePath, "auto")
	if err != nil {
		s.writeTooManyActiveJobs(w, err)
		return
	}

	go s.runAsciicastConversion(job.JobID, req.FilePath)
	writeJSON(w, http.StatusAccepted, map[string]string{"jobId": job.JobID, "status": "pending"})
}

func (s *server) handleStatus(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	jobID := strings.TrimPrefix(r.URL.Path, "/status/")
	if jobID == "" {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}

	j := s.jobs.get(jobID)
	if j == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "job not found"})
		return
	}

	resp := map[string]any{
		"jobId":  j.JobID,
		"status": j.Status,
	}
	if j.Status == "complete" {
		resp["outputPath"] = j.OutputPath
		resp["fileSize"] = j.FileSize
	}
	if j.Status == "error" {
		resp["error"] = j.Error
		resp["detail"] = j.Detail
		resp["returncode"] = j.ReturnCode
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *server) handleListConversions(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		methodNotAllowed(w)
		return
	}

	jobs, total := s.jobs.list()
	summary := make([]map[string]any, 0, len(jobs))
	for _, j := range jobs {
		summary = append(summary, map[string]any{
			"jobId":     j.JobID,
			"status":    j.Status,
			"filePath":  j.FilePath,
			"createdAt": j.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"jobs": summary, "total": total})
}

func (s *server) handleDeleteCache(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		methodNotAllowed(w)
		return
	}

	var req cacheDeleteRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if !strings.HasPrefix(req.FilePath, s.cfg.allowedPrefix) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "filePath must start with " + s.cfg.allowedPrefix})
		return
	}

	for _, ext := range []string{".m4v", ".mp4"} {
		target := req.FilePath + ext
		if _, err := os.Stat(target); err == nil {
			if err := os.Remove(target); err != nil {
				writeJSON(w, http.StatusInternalServerError, map[string]string{"error": fmt.Sprintf("failed to delete: %v", err)})
				return
			}
			writeJSON(w, http.StatusOK, map[string]any{"deleted": true, "path": target})
			return
		}
	}

	writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("cached file not found for: %s", req.FilePath)})
}

func (s *server) handleCleanup(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		methodNotAllowed(w)
		return
	}

	var req cleanupRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	maxAgeDays := defaultCleanupMaxAgeDays
	if req.MaxAgeDays != nil {
		if *req.MaxAgeDays < 1 {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "maxAgeDays must be a positive integer"})
			return
		}
		maxAgeDays = *req.MaxAgeDays
	}

	result := cleanupVideoFiles(s.cfg.allowedPrefix, maxAgeDays)
	writeJSON(w, http.StatusOK, result)
}

func (s *server) validateRecordingFile(w http.ResponseWriter, filePath string) bool {
	if filePath == "" || !strings.HasPrefix(filePath, s.cfg.allowedPrefix) {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "filePath must start with " + s.cfg.allowedPrefix})
		return false
	}
	if info, err := os.Stat(filePath); err != nil || info.IsDir() {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": fmt.Sprintf("source file not found: %s", filePath)})
		return false
	}
	return true
}

func (s *server) writeTooManyActiveJobs(w http.ResponseWriter, err error) {
	var limitErr errTooManyActiveJobs
	if errors.As(err, &limitErr) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{
			"error":      err.Error(),
			"activeJobs": s.jobs.activeCount(),
		})
		return
	}
	writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
}

func (s *server) runGuacConversion(jobID, filePath string, width, height int) {
	s.jobs.update(jobID, "converting", nil)

	ctx, cancel := context.WithTimeout(context.Background(), s.cfg.guacencTimeout)
	defer cancel()

	outputPath := filePath + ".m4v"
	cmd := exec.CommandContext(ctx, "guacenc", "-s", fmt.Sprintf("%dx%d", width, height), filePath)
	output, err := cmd.CombinedOutput()

	if ctx.Err() == context.DeadlineExceeded {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = fmt.Sprintf("guacenc timed out after %ds", int(s.cfg.guacencTimeout.Seconds()))
			j.ReturnCode = -1
		})
		return
	}

	if err != nil || !fileExists(outputPath) {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = "guacenc conversion failed"
			j.Detail = trimCommandOutput(output)
			j.ReturnCode = exitCode(err)
		})
		return
	}

	info, statErr := os.Stat(outputPath)
	if statErr != nil {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = "unexpected error"
			j.Detail = statErr.Error()
			j.ReturnCode = -1
		})
		return
	}

	s.jobs.update(jobID, "complete", func(j *job) {
		j.OutputPath = outputPath
		j.FileSize = info.Size()
	})
}

func (s *server) runAsciicastConversion(jobID, filePath string) {
	s.jobs.update(jobID, "converting", nil)

	outputPath := filePath + ".mp4"
	gifPath := filePath + ".gif"
	defer func() {
		_ = os.Remove(gifPath)
	}()

	aggCtx, aggCancel := context.WithTimeout(context.Background(), s.cfg.asciicastTimeout)
	defer aggCancel()

	aggCmd := exec.CommandContext(
		aggCtx,
		"agg",
		"--font-size", strconv.Itoa(s.cfg.aggFontSize),
		"--theme", s.cfg.aggTheme,
		filePath,
		gifPath,
	)
	aggOutput, aggErr := aggCmd.CombinedOutput()
	if aggCtx.Err() == context.DeadlineExceeded {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = fmt.Sprintf("asciicast conversion timed out after %ds", int(s.cfg.asciicastTimeout.Seconds()))
			j.ReturnCode = -1
		})
		return
	}
	if aggErr != nil || !fileExists(gifPath) {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = "agg rendering failed"
			j.Detail = trimCommandOutput(aggOutput)
			j.ReturnCode = exitCode(aggErr)
		})
		return
	}

	ffmpegCtx, ffmpegCancel := context.WithTimeout(context.Background(), s.cfg.asciicastTimeout)
	defer ffmpegCancel()

	ffmpegCmd := exec.CommandContext(
		ffmpegCtx,
		"ffmpeg", "-y",
		"-i", gifPath,
		"-movflags", "+faststart",
		"-pix_fmt", "yuv420p",
		"-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
		outputPath,
	)
	ffmpegOutput, ffmpegErr := ffmpegCmd.CombinedOutput()
	if ffmpegCtx.Err() == context.DeadlineExceeded {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = fmt.Sprintf("asciicast conversion timed out after %ds", int(s.cfg.asciicastTimeout.Seconds()))
			j.ReturnCode = -1
		})
		return
	}
	if ffmpegErr != nil || !fileExists(outputPath) {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = "ffmpeg conversion failed"
			j.Detail = trimCommandOutput(ffmpegOutput)
			j.ReturnCode = exitCode(ffmpegErr)
		})
		return
	}

	info, err := os.Stat(outputPath)
	if err != nil {
		s.jobs.update(jobID, "error", func(j *job) {
			j.Error = "unexpected error"
			j.Detail = err.Error()
			j.ReturnCode = -1
		})
		return
	}

	s.jobs.update(jobID, "complete", func(j *job) {
		j.OutputPath = outputPath
		j.FileSize = info.Size()
	})
}

func cleanupVideoFiles(root string, maxAgeDays int) map[string]any {
	cutoff := time.Now().Add(-time.Duration(maxAgeDays) * 24 * time.Hour)
	deleted := 0
	errorsCount := 0
	var freedBytes int64

	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			errorsCount++
			return nil
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".m4v") && !strings.HasSuffix(path, ".mp4") {
			return nil
		}

		info, statErr := d.Info()
		if statErr != nil {
			errorsCount++
			return nil
		}
		if !info.ModTime().Before(cutoff) {
			return nil
		}
		freedBytes += info.Size()
		if removeErr := os.Remove(path); removeErr != nil {
			errorsCount++
			return nil
		}
		deleted++
		return nil
	})

	return map[string]any{
		"deleted":    deleted,
		"errors":     errorsCount,
		"freedBytes": freedBytes,
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, dest any) bool {
	defer r.Body.Close()
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(dest); err != nil {
		if errors.Is(err, io.EOF) {
			return true
		}
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body"})
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		log.Printf("failed to encode response: %v", err)
	}
}

func notFound(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusNotFound, map[string]string{"error": "not found"})
}

func methodNotAllowed(w http.ResponseWriter) {
	writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
}

func envInt(key string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return value
}

func envDurationSeconds(key string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	value, err := strconv.Atoi(raw)
	if err != nil || value <= 0 {
		return fallback
	}
	return time.Duration(value) * time.Second
}

func envString(key, fallback string) string {
	raw := strings.TrimSpace(os.Getenv(key))
	if raw == "" {
		return fallback
	}
	return raw
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func readSecret(secretName, envFallback, defaultValue string) string {
	secretsDir := envString("SECRETS_DIR", "/run/secrets")
	secretPath := filepath.Join(secretsDir, secretName)
	if value, err := os.ReadFile(secretPath); err == nil {
		trimmed := strings.TrimSpace(string(value))
		if trimmed != "" {
			return trimmed
		}
	}
	if value := strings.TrimSpace(os.Getenv(envFallback)); value != "" {
		return value
	}
	return defaultValue
}

func fileExists(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

func exitCode(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return -1
}

func trimCommandOutput(output []byte) string {
	text := strings.TrimSpace(string(output))
	if text == "" {
		return "unknown error"
	}
	if len(text) > maxCommandOutputBytes {
		return text[:maxCommandOutputBytes] + "...(truncated)"
	}
	return text
}

func enabledDisabled(enabled bool) string {
	if enabled {
		return "enabled"
	}
	return "disabled"
}

func roundDurationSeconds(d time.Duration) float64 {
	return float64(d.Round(100*time.Millisecond)) / float64(time.Second)
}

func newJobID() string {
	return fmt.Sprintf("%d%x", time.Now().UnixNano(), os.Getpid())
}
