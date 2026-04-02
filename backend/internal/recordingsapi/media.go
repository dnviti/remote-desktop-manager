package recordingsapi

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
	"github.com/jackc/pgx/v5"
)

const (
	maxAnalyzeBytes         = 10 * 1024 * 1024
	guacencPollInterval     = 2 * time.Second
	guacencSubmitTimeout    = 10 * time.Second
	guacencStatusTimeout    = 5 * time.Second
	defaultGuacencTimeout   = 120 * time.Second
	defaultVideoWidth       = 1024
	defaultVideoHeight      = 768
	recordingContentTypeRaw = "application/octet-stream"
)

type recordingAnalysisResponse struct {
	FileSize       int            `json:"fileSize"`
	Truncated      bool           `json:"truncated"`
	Instructions   map[string]int `json:"instructions"`
	SyncCount      int            `json:"syncCount"`
	DisplayWidth   int            `json:"displayWidth"`
	DisplayHeight  int            `json:"displayHeight"`
	HasLayer0Image bool           `json:"hasLayer0Image"`
}

func (s Service) HandleStream(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		s.writeRecordingError(w, err, "Recording not found")
		return
	}
	if err := s.streamRecordingFile(w, item); err != nil {
		s.writeRecordingError(w, err, "Recording file not found on disk")
	}
}

func (s Service) HandleAnalyze(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		s.writeRecordingError(w, err, "Recording not found")
		return
	}

	result, err := s.AnalyzeRecording(r.Context(), item)
	if err != nil {
		s.writeRecordingError(w, err, "Failed to analyze recording")
		return
	}
	app.WriteJSON(w, http.StatusOK, result)
}

func (s Service) HandleExportVideo(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims.UserID)
	if err != nil {
		s.writeRecordingError(w, err, "Recording not found")
		return
	}

	videoPath, fileSize, err := s.ConvertToVideo(r.Context(), item)
	if err != nil {
		s.writeRecordingError(w, err, "Video conversion failed")
		return
	}

	if err := s.insertAuditLog(r.Context(), claims.UserID, "RECORDING_EXPORT_VIDEO", item.ID, map[string]any{
		"recordingId": item.ID,
	}, requestIP(r)); err != nil {
		s.writeRecordingError(w, err, "Failed to write audit log")
		return
	}

	file, err := os.Open(videoPath)
	if err != nil {
		if os.IsNotExist(err) {
			app.ErrorJSON(w, http.StatusNotFound, "Converted video file not found")
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
		return
	}
	defer file.Close()

	w.Header().Set("Content-Type", "video/mp4")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="recording-%s.m4v"`, item.ID))
	w.Header().Set("Content-Length", strconv.FormatInt(fileSize, 10))

	if _, err := io.Copy(w, file); err == nil {
		_ = os.Remove(videoPath)
	}
}

func (s Service) AnalyzeRecording(_ context.Context, item recordingResponse) (recordingAnalysisResponse, error) {
	if item.Format != "guac" {
		return recordingAnalysisResponse{}, &requestError{status: http.StatusBadRequest, message: "Only .guac recordings can be analyzed"}
	}

	file, err := os.Open(item.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return recordingAnalysisResponse{}, &requestError{status: http.StatusNotFound, message: "Recording file not found on disk"}
		}
		return recordingAnalysisResponse{}, fmt.Errorf("open recording: %w", err)
	}
	defer file.Close()

	payload, err := io.ReadAll(io.LimitReader(file, maxAnalyzeBytes+1))
	if err != nil {
		return recordingAnalysisResponse{}, fmt.Errorf("read recording: %w", err)
	}
	truncated := len(payload) > maxAnalyzeBytes
	if truncated {
		payload = payload[:maxAnalyzeBytes]
	}
	content := string(payload)

	instructions := make(map[string]int)
	displayWidth := 0
	displayHeight := 0
	hasLayer0Image := false

	for pos := 0; pos < len(content); {
		for pos < len(content) {
			switch content[pos] {
			case '\n', '\r', '\t', ' ':
				pos++
			default:
				goto parseInstruction
			}
		}
		break

	parseInstruction:
		semi := strings.IndexByte(content[pos:], ';')
		if semi == -1 {
			break
		}
		semi += pos
		raw := content[pos : semi+1]
		pos = semi + 1

		dot := strings.IndexByte(raw, '.')
		if dot == -1 {
			continue
		}
		opcodeLen, err := strconv.Atoi(raw[:dot])
		if err != nil || opcodeLen <= 0 || dot+1+opcodeLen > len(raw) {
			continue
		}
		opcode := raw[dot+1 : dot+1+opcodeLen]
		instructions[opcode]++

		switch opcode {
		case "size":
			parts := parseGuacArgs(raw)
			if len(parts) >= 3 && parts[0] == "0" {
				if value, err := strconv.Atoi(parts[1]); err == nil {
					displayWidth = value
				}
				if value, err := strconv.Atoi(parts[2]); err == nil {
					displayHeight = value
				}
			}
		case "img":
			if hasLayer0Image {
				continue
			}
			parts := parseGuacArgs(raw)
			if len(parts) >= 2 && parts[1] == "0" {
				hasLayer0Image = true
			}
		}
	}

	return recordingAnalysisResponse{
		FileSize:       len(payload),
		Truncated:      truncated,
		Instructions:   instructions,
		SyncCount:      instructions["sync"],
		DisplayWidth:   displayWidth,
		DisplayHeight:  displayHeight,
		HasLayer0Image: hasLayer0Image,
	}, nil
}

func (s Service) ConvertToVideo(ctx context.Context, item recordingResponse) (string, int64, error) {
	if item.Status != "COMPLETE" {
		return "", 0, &requestError{status: http.StatusBadRequest, message: "Recording is not complete"}
	}
	if item.Format != "guac" && item.Format != "asciicast" {
		return "", 0, &requestError{status: http.StatusBadRequest, message: "Video export is only available for RDP/VNC/SSH recordings"}
	}

	videoExt := ".m4v"
	if item.Format == "asciicast" {
		videoExt = ".mp4"
	}
	videoPath := item.FilePath + videoExt
	if info, err := os.Stat(videoPath); err == nil {
		return videoPath, info.Size(), nil
	}

	serviceURL := s.GuacencServiceURL
	endpoint := "/convert"
	if item.Format == "asciicast" {
		if strings.TrimSpace(s.AsciicastConverterURL) != "" {
			serviceURL = s.AsciicastConverterURL
		}
		endpoint = "/convert-asciicast"
	}
	serviceURL = s.resolveGuacencURL(serviceURL)
	if strings.TrimSpace(serviceURL) == "" {
		return "", 0, &requestError{status: http.StatusServiceUnavailable, message: "Video conversion service unavailable"}
	}

	client, err := s.guacencClient()
	if err != nil {
		return "", 0, fmt.Errorf("configure guacenc client: %w", err)
	}

	body := map[string]any{
		"filePath": s.toContainerPath(item.FilePath),
	}
	if item.Format != "asciicast" {
		width := defaultVideoWidth
		height := defaultVideoHeight
		if item.Width != nil && *item.Width > 0 {
			width = *item.Width
		}
		if item.Height != nil && *item.Height > 0 {
			height = *item.Height
		}
		body["width"] = width
		body["height"] = height
	}
	rawBody, err := json.Marshal(body)
	if err != nil {
		return "", 0, fmt.Errorf("marshal conversion request: %w", err)
	}

	submitCtx, cancelSubmit := context.WithTimeout(ctx, guacencSubmitTimeout)
	defer cancelSubmit()

	req, err := http.NewRequestWithContext(submitCtx, http.MethodPost, serviceURL+endpoint, strings.NewReader(string(rawBody)))
	if err != nil {
		return "", 0, fmt.Errorf("create conversion request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if token := strings.TrimSpace(s.GuacencAuthToken); token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}

	resp, err := client.Do(req)
	if err != nil {
		return "", 0, s.mapFetchError(err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var payload map[string]any
		_ = json.NewDecoder(resp.Body).Decode(&payload)
		detail, _ := payload["error"].(string)
		if detail == "" {
			detail = fmt.Sprintf("HTTP %d", resp.StatusCode)
		}
		status := http.StatusServiceUnavailable
		if resp.StatusCode < 500 {
			status = http.StatusBadGateway
		}
		return "", 0, &requestError{status: status, message: "Video conversion failed: " + detail}
	}

	var submitResult struct {
		JobID string `json:"jobId"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&submitResult); err != nil {
		return "", 0, fmt.Errorf("decode conversion response: %w", err)
	}
	if strings.TrimSpace(submitResult.JobID) == "" {
		return "", 0, &requestError{status: http.StatusBadGateway, message: "Video conversion failed: missing job id"}
	}

	deadline := time.Now().Add(s.guacencTimeout())
	for time.Now().Before(deadline) {
		select {
		case <-ctx.Done():
			return "", 0, ctx.Err()
		case <-time.After(guacencPollInterval):
		}

		statusCtx, cancelStatus := context.WithTimeout(ctx, guacencStatusTimeout)
		statusReq, err := http.NewRequestWithContext(statusCtx, http.MethodGet, serviceURL+"/status/"+submitResult.JobID, nil)
		if err != nil {
			cancelStatus()
			return "", 0, fmt.Errorf("create status request: %w", err)
		}
		if token := strings.TrimSpace(s.GuacencAuthToken); token != "" {
			statusReq.Header.Set("Authorization", "Bearer "+token)
		}

		statusResp, err := client.Do(statusReq)
		if err != nil {
			cancelStatus()
			return "", 0, s.mapFetchError(err)
		}

		var job struct {
			Status     string `json:"status"`
			OutputPath string `json:"outputPath"`
			FileSize   int64  `json:"fileSize"`
			Error      string `json:"error"`
		}
		decodeErr := json.NewDecoder(statusResp.Body).Decode(&job)
		statusResp.Body.Close()
		cancelStatus()
		if decodeErr != nil {
			return "", 0, fmt.Errorf("decode status response: %w", decodeErr)
		}
		if statusResp.StatusCode < 200 || statusResp.StatusCode >= 300 {
			return "", 0, &requestError{status: http.StatusBadGateway, message: "Failed to check conversion status"}
		}

		switch job.Status {
		case "complete":
			return s.toHostPath(job.OutputPath), job.FileSize, nil
		case "error":
			detail := strings.TrimSpace(job.Error)
			if detail == "" {
				detail = "unknown"
			}
			return "", 0, &requestError{status: http.StatusBadGateway, message: "Video conversion failed: " + detail}
		}
	}

	return "", 0, &requestError{status: http.StatusGatewayTimeout, message: "Video conversion timed out"}
}

func (s Service) streamRecordingFile(w http.ResponseWriter, item recordingResponse) error {
	file, err := os.Open(item.FilePath)
	if err != nil {
		if os.IsNotExist(err) {
			return &requestError{status: http.StatusNotFound, message: "Recording file not found on disk"}
		}
		return fmt.Errorf("open recording stream: %w", err)
	}
	defer file.Close()

	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat recording stream: %w", err)
	}
	contentType, ext := contentTypeForFormat(item.Format)
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="recording-%s.%s"`, item.ID, ext))
	if info.Size() > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(info.Size(), 10))
	}

	_, err = io.Copy(w, file)
	return err
}

func contentTypeForFormat(format string) (contentType string, ext string) {
	switch format {
	case "asciicast":
		return "application/x-asciicast", "cast"
	case "guac":
		return recordingContentTypeRaw, "guac"
	default:
		return recordingContentTypeRaw, format
	}
}

func parseGuacArgs(instruction string) []string {
	trimmed := strings.TrimSuffix(instruction, ";")
	args := make([]string, 0, 8)
	for pos := 0; pos < len(trimmed); {
		dot := strings.IndexByte(trimmed[pos:], '.')
		if dot == -1 {
			break
		}
		dot += pos
		length, err := strconv.Atoi(trimmed[pos:dot])
		if err != nil || length < 0 {
			break
		}
		start := dot + 1
		end := start + length
		if end > len(trimmed) {
			break
		}
		args = append(args, trimmed[start:end])
		pos = end
		if pos >= len(trimmed) {
			break
		}
		if trimmed[pos] != ',' {
			break
		}
		pos++
	}
	if len(args) <= 1 {
		return []string{}
	}
	return args[1:]
}

func (s Service) resolveGuacencURL(baseURL string) string {
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		return ""
	}
	if s.GuacencUseTLS {
		return strings.Replace(baseURL, "http://", "https://", 1)
	}
	return baseURL
}

func (s Service) toContainerPath(hostPath string) string {
	recordingPath := strings.TrimRight(strings.TrimSpace(s.RecordingPath), "/")
	containerPath := strings.TrimRight(strings.TrimSpace(s.GuacencRecordingPath), "/")
	if recordingPath == "" || containerPath == "" {
		return hostPath
	}
	if hostPath == recordingPath {
		return containerPath
	}
	if strings.HasPrefix(hostPath, recordingPath+"/") {
		return containerPath + strings.TrimPrefix(hostPath, recordingPath)
	}
	return hostPath
}

func (s Service) toHostPath(containerPath string) string {
	recordingPath := strings.TrimRight(strings.TrimSpace(s.RecordingPath), "/")
	guacPath := strings.TrimRight(strings.TrimSpace(s.GuacencRecordingPath), "/")
	if recordingPath == "" || guacPath == "" {
		return containerPath
	}
	if containerPath == guacPath {
		return recordingPath
	}
	if strings.HasPrefix(containerPath, guacPath+"/") {
		return recordingPath + strings.TrimPrefix(containerPath, guacPath)
	}
	return containerPath
}

func (s Service) guacencTimeout() time.Duration {
	if s.GuacencTimeout > 0 {
		return s.GuacencTimeout
	}
	return defaultGuacencTimeout
}

func (s Service) guacencClient() (*http.Client, error) {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	if !s.GuacencUseTLS {
		return &http.Client{Transport: transport}, nil
	}

	rootCAs, err := x509.SystemCertPool()
	if err != nil || rootCAs == nil {
		rootCAs = x509.NewCertPool()
	}
	if certPath := strings.TrimSpace(s.GuacencTLSCA); certPath != "" {
		pem, readErr := os.ReadFile(certPath)
		if readErr != nil {
			return nil, fmt.Errorf("read guacenc CA: %w", readErr)
		}
		if ok := rootCAs.AppendCertsFromPEM(pem); !ok {
			return nil, errors.New("failed to append guacenc CA certificate")
		}
	}

	transport.TLSClientConfig = &tls.Config{
		MinVersion: tls.VersionTLS12,
		RootCAs:    rootCAs,
	}
	return &http.Client{Transport: transport}, nil
}

func (s Service) mapFetchError(err error) error {
	var reqErr *requestError
	if errors.As(err, &reqErr) {
		return reqErr
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return &requestError{status: http.StatusGatewayTimeout, message: "Video conversion timed out"}
	}
	return &requestError{status: http.StatusServiceUnavailable, message: "Video conversion service unavailable"}
}

func (s Service) writeRecordingError(w http.ResponseWriter, err error, fallback string) {
	switch {
	case err == nil:
		return
	case errors.Is(err, pgx.ErrNoRows):
		app.ErrorJSON(w, http.StatusNotFound, fallback)
	default:
		var reqErr *requestError
		if errors.As(err, &reqErr) {
			app.ErrorJSON(w, reqErr.status, reqErr.message)
			return
		}
		app.ErrorJSON(w, http.StatusServiceUnavailable, err.Error())
	}
}
