package terminalbroker

import "sync"

type runtimeRegistry struct {
	mu       sync.Mutex
	runtimes map[string]*terminalRuntime
}

func newRuntimeRegistry() *runtimeRegistry {
	return &runtimeRegistry{runtimes: make(map[string]*terminalRuntime)}
}

func (r *runtimeRegistry) add(sessionID string, runtime *terminalRuntime) bool {
	if sessionID == "" || runtime == nil {
		return true
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if existing, ok := r.runtimes[sessionID]; ok {
		select {
		case <-existing.closed:
			delete(r.runtimes, sessionID)
		default:
			return false
		}
	}
	r.runtimes[sessionID] = runtime
	return true
}

func (r *runtimeRegistry) get(sessionID string) (*terminalRuntime, bool) {
	if sessionID == "" {
		return nil, false
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	runtime, ok := r.runtimes[sessionID]
	if !ok || runtime == nil {
		return nil, false
	}
	select {
	case <-runtime.closed:
		delete(r.runtimes, sessionID)
		return nil, false
	default:
		return runtime, true
	}
}

func (r *runtimeRegistry) remove(sessionID string, runtime *terminalRuntime) {
	if sessionID == "" || runtime == nil {
		return
	}

	r.mu.Lock()
	defer r.mu.Unlock()
	if current, ok := r.runtimes[sessionID]; ok && current == runtime {
		delete(r.runtimes, sessionID)
	}
}
