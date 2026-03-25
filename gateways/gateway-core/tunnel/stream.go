package tunnel

import (
	"errors"
	"io"
	"sync"
)

var (
	// ErrStreamClosed is returned when reading or writing to a closed stream.
	ErrStreamClosed = errors.New("stream closed")
)

// Stream represents a single multiplexed stream within the tunnel. It
// implements io.ReadWriteCloser for convenient bidirectional I/O.
type Stream struct {
	id       uint16
	sendFunc func(streamID uint16, data []byte) error
	readBuf  chan []byte
	closed   bool
	mu       sync.Mutex
}

// newStream creates a new stream with the given ID and send function.
func newStream(id uint16, sendFunc func(uint16, []byte) error) *Stream {
	return &Stream{
		id:       id,
		sendFunc: sendFunc,
		readBuf:  make(chan []byte, 256),
	}
}

// ID returns the stream identifier.
func (s *Stream) ID() uint16 {
	return s.id
}

// Read reads data from the stream's receive buffer. It blocks until data is
// available or the stream is closed.
func (s *Stream) Read(p []byte) (int, error) {
	data, ok := <-s.readBuf
	if !ok {
		return 0, io.EOF
	}
	n := copy(p, data)
	return n, nil
}

// Write sends data over the tunnel for this stream. It is safe for concurrent
// use.
func (s *Stream) Write(p []byte) (int, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return 0, ErrStreamClosed
	}
	s.mu.Unlock()

	if err := s.sendFunc(s.id, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Close closes the stream. Subsequent reads will drain the buffer then return
// io.EOF. Subsequent writes return ErrStreamClosed.
func (s *Stream) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil
	}
	s.closed = true
	close(s.readBuf)
	return nil
}

// deliver enqueues received data into the stream's read buffer. Returns false
// if the stream is closed or the buffer is full (data dropped).
func (s *Stream) deliver(data []byte) bool {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return false
	}
	s.mu.Unlock()

	select {
	case s.readBuf <- data:
		return true
	default:
		// Buffer full — drop data to prevent blocking the tunnel read loop.
		return false
	}
}
