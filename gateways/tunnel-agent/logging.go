package main

import (
	"fmt"
	"io"
	"sync"
)

type agentLogger struct {
	stdout io.Writer
	stderr io.Writer
	mu     sync.Mutex
}

func newAgentLogger(stdout, stderr io.Writer) *agentLogger {
	return &agentLogger{stdout: stdout, stderr: stderr}
}

func (l *agentLogger) log(format string, args ...any) {
	l.write(l.stdout, "[tunnel-agent] "+fmt.Sprintf(format, args...)+"\n")
}

func (l *agentLogger) warn(format string, args ...any) {
	l.write(l.stderr, "[tunnel-agent] WARN "+fmt.Sprintf(format, args...)+"\n")
}

func (l *agentLogger) err(format string, args ...any) {
	l.write(l.stderr, "[tunnel-agent] ERROR "+fmt.Sprintf(format, args...)+"\n")
}

func (l *agentLogger) write(writer io.Writer, message string) {
	if writer == nil {
		return
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	_, _ = io.WriteString(writer, message)
}
