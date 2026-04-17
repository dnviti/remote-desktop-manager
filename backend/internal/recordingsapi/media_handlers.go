package recordingsapi

import (
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"

	"github.com/dnviti/arsenale/backend/internal/app"
	"github.com/dnviti/arsenale/backend/internal/authn"
)

func (s Service) HandleStream(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims)
	if err != nil {
		s.writeRecordingError(w, err, "Recording not found")
		return
	}
	if err := s.streamRecordingFile(w, item); err != nil {
		s.writeRecordingError(w, err, "Recording file not found on disk")
	}
}

func (s Service) HandleAnalyze(w http.ResponseWriter, r *http.Request, claims authn.Claims) {
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims)
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
	item, err := s.GetRecording(r.Context(), r.PathValue("id"), claims)
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
