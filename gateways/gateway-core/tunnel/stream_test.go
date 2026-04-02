package tunnel

import (
	"bytes"
	"io"
	"sync"
	"testing"
)

func TestNewStream(t *testing.T) {
	sendCalled := false
	s := newStream(42, func(id uint16, data []byte) error {
		sendCalled = true
		return nil
	})

	if s.ID() != 42 {
		t.Errorf("ID: got %d, want 42", s.ID())
	}
	if sendCalled {
		t.Error("sendFunc should not be called during construction")
	}
}

func TestStreamReadDeliverBasic(t *testing.T) {
	s := newStream(1, nil)

	payload := []byte("hello world")
	if !s.deliver(payload) {
		t.Fatal("deliver returned false unexpectedly")
	}

	buf := make([]byte, 1024)
	n, err := s.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if string(buf[:n]) != "hello world" {
		t.Errorf("Read: got %q, want %q", string(buf[:n]), "hello world")
	}
}

func TestStreamReadPartialBuffer(t *testing.T) {
	s := newStream(1, nil)

	payload := []byte("abcdefghij") // 10 bytes
	if !s.deliver(payload) {
		t.Fatal("deliver returned false")
	}

	// Read into a small buffer — only 4 bytes.
	buf := make([]byte, 4)
	n, err := s.Read(buf)
	if err != nil {
		t.Fatalf("first Read error: %v", err)
	}
	if n != 4 || string(buf[:n]) != "abcd" {
		t.Errorf("first Read: got %q (n=%d), want %q", string(buf[:n]), n, "abcd")
	}

	// Second read should return the remainder from the same chunk.
	n, err = s.Read(buf)
	if err != nil {
		t.Fatalf("second Read error: %v", err)
	}
	if n != 4 || string(buf[:n]) != "efgh" {
		t.Errorf("second Read: got %q (n=%d), want %q", string(buf[:n]), n, "efgh")
	}

	// Third read returns the last 2 bytes.
	n, err = s.Read(buf)
	if err != nil {
		t.Fatalf("third Read error: %v", err)
	}
	if n != 2 || string(buf[:n]) != "ij" {
		t.Errorf("third Read: got %q (n=%d), want %q", string(buf[:n]), n, "ij")
	}
}

func TestStreamReadClosedReturnsEOF(t *testing.T) {
	s := newStream(1, nil)
	_ = s.Close()

	buf := make([]byte, 64)
	_, err := s.Read(buf)
	if err != io.EOF {
		t.Errorf("Read on closed stream: got err=%v, want io.EOF", err)
	}
}

func TestStreamReadDrainsBufferBeforeEOF(t *testing.T) {
	s := newStream(1, nil)

	// Deliver data then close.
	s.deliver([]byte("buffered"))
	_ = s.Close()

	buf := make([]byte, 64)
	n, err := s.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if string(buf[:n]) != "buffered" {
		t.Errorf("Read: got %q, want %q", string(buf[:n]), "buffered")
	}

	// Next read should return EOF.
	_, err = s.Read(buf)
	if err != io.EOF {
		t.Errorf("second Read: got err=%v, want io.EOF", err)
	}
}

func TestStreamWriteSendsViaSendFunc(t *testing.T) {
	var capturedID uint16
	var capturedData []byte
	s := newStream(7, func(id uint16, data []byte) error {
		capturedID = id
		capturedData = make([]byte, len(data))
		copy(capturedData, data)
		return nil
	})

	payload := []byte("write-test")
	n, err := s.Write(payload)
	if err != nil {
		t.Fatalf("Write error: %v", err)
	}
	if n != len(payload) {
		t.Errorf("Write n: got %d, want %d", n, len(payload))
	}
	if capturedID != 7 {
		t.Errorf("sendFunc streamID: got %d, want 7", capturedID)
	}
	if !bytes.Equal(capturedData, payload) {
		t.Errorf("sendFunc data: got %q, want %q", capturedData, payload)
	}
}

func TestStreamWriteClosedReturnsError(t *testing.T) {
	s := newStream(1, func(uint16, []byte) error {
		t.Fatal("sendFunc should not be called on closed stream")
		return nil
	})
	_ = s.Close()

	_, err := s.Write([]byte("data"))
	if err != ErrStreamClosed {
		t.Errorf("Write on closed stream: got err=%v, want ErrStreamClosed", err)
	}
}

func TestStreamCloseIdempotent(t *testing.T) {
	s := newStream(1, nil)

	// Close multiple times — should not panic.
	for i := 0; i < 5; i++ {
		if err := s.Close(); err != nil {
			t.Errorf("Close #%d returned error: %v", i+1, err)
		}
	}
}

func TestStreamDeliverBufferFull(t *testing.T) {
	s := newStream(1, nil)

	// Fill the buffer (capacity 256).
	for i := 0; i < 256; i++ {
		if !s.deliver([]byte{byte(i)}) {
			t.Fatalf("deliver failed at index %d, expected buffer capacity of 256", i)
		}
	}

	// Next deliver should return false (buffer full).
	if s.deliver([]byte("overflow")) {
		t.Error("deliver should return false when buffer is full")
	}
}

func TestStreamDeliverClosedReturnsFalse(t *testing.T) {
	s := newStream(1, nil)
	_ = s.Close()

	if s.deliver([]byte("data")) {
		t.Error("deliver should return false on closed stream")
	}
}

func TestStreamDeliverDefensiveCopy(t *testing.T) {
	s := newStream(1, nil)

	original := []byte("original")
	s.deliver(original)

	// Mutate the caller's buffer after deliver.
	original[0] = 'X'

	buf := make([]byte, 64)
	n, err := s.Read(buf)
	if err != nil {
		t.Fatalf("Read error: %v", err)
	}
	if buf[0] == 'X' {
		t.Error("deliver did not defensively copy data — caller mutation leaked through")
	}
	if string(buf[:n]) != "original" {
		t.Errorf("Read: got %q, want %q", string(buf[:n]), "original")
	}
}

func TestStreamConcurrentReadWrite(t *testing.T) {
	var writeCount int64
	var mu sync.Mutex
	var firstWrite sync.Once

	start := make(chan struct{})
	firstWriteDone := make(chan struct{})

	s := newStream(1, func(_ uint16, data []byte) error {
		mu.Lock()
		writeCount++
		mu.Unlock()
		firstWrite.Do(func() {
			close(firstWriteDone)
		})
		return nil
	})

	const goroutines = 10
	const iterations = 50

	var wg sync.WaitGroup

	// Concurrent writers — exercise Write path under race detector.
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for i := 0; i < iterations; i++ {
				_, _ = s.Write([]byte("w"))
			}
		}()
	}

	// Concurrent delivers — exercise deliver path under race detector.
	for g := 0; g < goroutines; g++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			for i := 0; i < iterations; i++ {
				s.deliver([]byte("r"))
			}
		}()
	}

	// Concurrent close — exercise Close under race detector.
	wg.Add(1)
	go func() {
		defer wg.Done()
		<-start
		<-firstWriteDone
		_ = s.Close()
	}()

	close(start)
	wg.Wait()

	// Drain any remaining buffered data so reads don't block.
	go func() {
		buf := make([]byte, 64)
		for {
			_, err := s.Read(buf)
			if err != nil {
				return
			}
		}
	}()

	mu.Lock()
	total := writeCount
	mu.Unlock()

	// All writes should have completed (sendFunc never errors).
	// Some may have hit the closed path, which is fine — we're checking for races.
	if total == 0 {
		t.Error("expected at least some writes to succeed")
	}
}
