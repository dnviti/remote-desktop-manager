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
	id        uint16
	sendFunc  func(streamID uint16, data []byte) error
	readBuf   chan []byte
	remainder []byte // leftover bytes from a partial Read
	done      chan struct{}
	closeOnce sync.Once
	mu        sync.Mutex
}

// newStream creates a new stream with the given ID and send function.
func newStream(id uint16, sendFunc func(uint16, []byte) error) *Stream {
	return &Stream{
		id:       id,
		sendFunc: sendFunc,
		readBuf:  make(chan []byte, 256),
		done:     make(chan struct{}),
	}
}

// ID returns the stream identifier.
func (s *Stream) ID() uint16 {
	return s.id
}

// Read reads data from the stream's receive buffer. It blocks until data is
// available or the stream is closed. If the caller's buffer is smaller than
// the received chunk, excess bytes are retained and returned on the next Read.
func (s *Stream) Read(p []byte) (int, error) {
	s.mu.Lock()
	// Return leftover bytes from a previous partial read first.
	if len(s.remainder) > 0 {
		n := copy(p, s.remainder)
		if n < len(s.remainder) {
			s.remainder = s.remainder[n:]
		} else {
			s.remainder = nil
		}
		s.mu.Unlock()
		return n, nil
	}
	s.mu.Unlock()

	select {
	case data, ok := <-s.readBuf:
		if !ok {
			return 0, io.EOF
		}
		n := copy(p, data)
		if n < len(data) {
			s.mu.Lock()
			s.remainder = data[n:]
			s.mu.Unlock()
		}
		return n, nil
	case <-s.done:
		// Drain any remaining buffered data before returning EOF.
		select {
		case data, ok := <-s.readBuf:
			if !ok {
				return 0, io.EOF
			}
			n := copy(p, data)
			if n < len(data) {
				s.mu.Lock()
				s.remainder = data[n:]
				s.mu.Unlock()
			}
			return n, nil
		default:
			return 0, io.EOF
		}
	}
}

// Write sends data over the tunnel for this stream. It is safe for concurrent
// use.
func (s *Stream) Write(p []byte) (int, error) {
	select {
	case <-s.done:
		return 0, ErrStreamClosed
	default:
	}

	if err := s.sendFunc(s.id, p); err != nil {
		return 0, err
	}
	return len(p), nil
}

// Close closes the stream. Subsequent reads will drain the buffer then return
// io.EOF. Subsequent writes return ErrStreamClosed. Close is safe for
// concurrent use and idempotent.
func (s *Stream) Close() error {
	s.closeOnce.Do(func() {
		close(s.done)
	})
	return nil
}

// deliver enqueues received data into the stream's read buffer. Returns false
// if the stream is closed or the buffer is full (data dropped).
func (s *Stream) deliver(data []byte) bool {
	// Check closed first to avoid sending to a closed stream's buffer.
	select {
	case <-s.done:
		return false
	default:
	}

	// Defensive copy to prevent the caller's buffer from being reused.
	buf := make([]byte, len(data))
	copy(buf, data)

	select {
	case s.readBuf <- buf:
		return true
	case <-s.done:
		return false
	default:
		// Buffer full — drop data to prevent blocking the tunnel read loop.
		return false
	}
}
