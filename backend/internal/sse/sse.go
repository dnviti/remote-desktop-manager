package sse

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type Stream struct {
	w       http.ResponseWriter
	flusher http.Flusher
}

func Open(w http.ResponseWriter) (*Stream, error) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		return nil, fmt.Errorf("streaming is not supported")
	}

	controller := http.NewResponseController(w)
	if err := controller.SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
		return nil, err
	}

	headers := w.Header()
	headers.Set("Content-Type", "text/event-stream")
	headers.Set("Cache-Control", "no-cache, no-transform")
	headers.Set("X-Accel-Buffering", "no")

	stream := &Stream{w: w, flusher: flusher}
	if _, err := w.Write([]byte("retry: 3000\n\n")); err != nil {
		return nil, err
	}
	flusher.Flush()
	return stream, nil
}

func (s *Stream) Event(event string, payload any) error {
	var builder strings.Builder
	if event != "" {
		builder.WriteString("event: ")
		builder.WriteString(event)
		builder.WriteByte('\n')
	}

	if payload != nil {
		body, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		for _, line := range strings.Split(string(body), "\n") {
			builder.WriteString("data: ")
			builder.WriteString(line)
			builder.WriteByte('\n')
		}
	}

	builder.WriteByte('\n')
	if _, err := s.w.Write([]byte(builder.String())); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}

func (s *Stream) Comment(comment string) error {
	var builder strings.Builder
	for _, line := range strings.Split(comment, "\n") {
		builder.WriteString(": ")
		builder.WriteString(line)
		builder.WriteByte('\n')
	}
	builder.WriteByte('\n')
	if _, err := s.w.Write([]byte(builder.String())); err != nil {
		return err
	}
	s.flusher.Flush()
	return nil
}
