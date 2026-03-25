package credential

import (
	"encoding/json"
	"fmt"
	"runtime"
	"sync"
	"sync/atomic"
	"testing"

	"github.com/dnviti/arsenale/gateways/gateway-core/protocol"
)

// makeResilienceCredFrame builds a CREDENTIAL_PUSH frame for resilience tests.
func makeResilienceCredFrame(sessionID string, creds Credentials) *protocol.Frame {
	payload := credentialPushPayload{
		SessionID:   sessionID,
		Credentials: creds,
	}
	data, _ := json.Marshal(payload)
	return &protocol.Frame{
		Type:    protocol.MsgCredentialPush,
		Payload: data,
	}
}

func TestConcurrentCredentialAccess(t *testing.T) {
	ch := NewCredentialHandler()

	const numSessions = 50
	const iterations = 100
	var wg sync.WaitGroup

	// Concurrent writers for different sessions.
	for i := 0; i < numSessions; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sid := fmt.Sprintf("concurrent-%04d", idx)
			for j := 0; j < iterations; j++ {
				frame := makeResilienceCredFrame(sid, Credentials{
					Username: fmt.Sprintf("user-%d-%d", idx, j),
					Password: fmt.Sprintf("pass-%d-%d", idx, j),
				})
				if err := ch.HandlePush(frame); err != nil {
					t.Errorf("HandlePush for %s: %v", sid, err)
				}
			}
		}(i)
	}

	// Concurrent readers for the same sessions.
	for i := 0; i < numSessions; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			sid := fmt.Sprintf("concurrent-%04d", idx)
			for j := 0; j < iterations; j++ {
				_, _ = ch.GetCredentials(sid)
			}
		}(i)
	}

	wg.Wait()

	// Verify all sessions have credentials.
	for i := 0; i < numSessions; i++ {
		sid := fmt.Sprintf("concurrent-%04d", i)
		creds, err := ch.GetCredentials(sid)
		if err != nil {
			t.Errorf("session %s: %v", sid, err)
			continue
		}
		if creds.Username == "" {
			t.Errorf("session %s: empty username", sid)
		}
	}
}

func TestCredentialZeroingVerification(t *testing.T) {
	ch := NewCredentialHandler()

	frame := makeResilienceCredFrame("zero-test", Credentials{
		Username:   "admin",
		Password:   "SuperSecret123!",
		PrivateKey: "-----BEGIN RSA PRIVATE KEY-----\nMIIEpA...\n-----END RSA PRIVATE KEY-----",
		Passphrase: "keypass",
		Extra:      map[string]string{"token": "abc123xyz", "domain": "CORP"},
	})
	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("HandlePush: %v", err)
	}

	// Get a reference to the stored credentials (internal access for testing).
	ch.mu.RLock()
	stored := ch.store["zero-test"]
	ch.mu.RUnlock()

	// Clear credentials.
	ch.ClearCredentials("zero-test")

	// Verify fields are zeroed (all bytes should be 0x00).
	checkZeroed := func(name, val string) {
		t.Helper()
		for i, b := range []byte(val) {
			if b != 0 {
				t.Errorf("%s not zeroed: byte %d is 0x%02x", name, i, b)
				return
			}
		}
	}

	checkZeroed("Username", stored.Username)
	checkZeroed("Password", stored.Password)
	checkZeroed("PrivateKey", stored.PrivateKey)
	checkZeroed("Passphrase", stored.Passphrase)
	for k, v := range stored.Extra {
		checkZeroed(fmt.Sprintf("Extra[%s]", k), v)
	}
}

func TestMassiveCredentialStore(t *testing.T) {
	ch := NewCredentialHandler()

	const numSessions = 10000

	// Record memory before.
	runtime.GC()
	var memBefore runtime.MemStats
	runtime.ReadMemStats(&memBefore)

	// Store credentials for all sessions.
	for i := 0; i < numSessions; i++ {
		sid := fmt.Sprintf("mass-%05d", i)
		frame := makeResilienceCredFrame(sid, Credentials{
			Username:   fmt.Sprintf("user-%d", i),
			Password:   fmt.Sprintf("password-%d-with-some-padding-to-be-realistic", i),
			PrivateKey: fmt.Sprintf("-----BEGIN KEY-----\n%d\n-----END KEY-----", i),
			Extra:      map[string]string{"domain": "CORP", "tenant": fmt.Sprintf("t-%d", i)},
		})
		if err := ch.HandlePush(frame); err != nil {
			t.Fatalf("HandlePush at %d: %v", i, err)
		}
	}

	// Verify count.
	ch.mu.RLock()
	count := len(ch.store)
	ch.mu.RUnlock()
	if count != numSessions {
		t.Errorf("expected %d stored credentials, got %d", numSessions, count)
	}

	// Record memory after storing.
	runtime.GC()
	var memAfter runtime.MemStats
	runtime.ReadMemStats(&memAfter)

	allocatedMB := float64(memAfter.Alloc-memBefore.Alloc) / (1024 * 1024)
	t.Logf("Memory used for %d sessions: %.2f MB", numSessions, allocatedMB)

	// Sanity check: should not use more than 100MB for 10k sessions.
	if allocatedMB > 100 {
		t.Errorf("excessive memory usage: %.2f MB for %d sessions", allocatedMB, numSessions)
	}

	// Clear all.
	ch.ClearAll()

	ch.mu.RLock()
	countAfter := len(ch.store)
	ch.mu.RUnlock()
	if countAfter != 0 {
		t.Errorf("expected 0 after ClearAll, got %d", countAfter)
	}

	// Force GC and verify memory is released.
	runtime.GC()
	var memFinal runtime.MemStats
	runtime.ReadMemStats(&memFinal)
	freedMB := float64(memAfter.Alloc-memFinal.Alloc) / (1024 * 1024)
	t.Logf("Memory freed after ClearAll: %.2f MB", freedMB)
}

func TestCredentialOverwriteAtomicity(t *testing.T) {
	ch := NewCredentialHandler()

	const sessionID = "atomic-test"

	// Seed with initial credentials.
	frame := makeResilienceCredFrame(sessionID, Credentials{
		Username: "initial-user",
		Password: "initial-pass",
	})
	if err := ch.HandlePush(frame); err != nil {
		t.Fatalf("initial push: %v", err)
	}

	const writers = 10
	const readers = 20
	const iterations = 200

	var wg sync.WaitGroup
	var partialReads atomic.Int64

	// Concurrent writers overwriting credentials.
	for i := 0; i < writers; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				user := fmt.Sprintf("writer-%d-iter-%d", idx, j)
				pass := fmt.Sprintf("pass-%d-iter-%d", idx, j)
				f := makeResilienceCredFrame(sessionID, Credentials{
					Username: user,
					Password: pass,
				})
				_ = ch.HandlePush(f)
			}
		}(i)
	}

	// Concurrent readers checking consistency.
	for i := 0; i < readers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := 0; j < iterations; j++ {
				creds, err := ch.GetCredentials(sessionID)
				if err != nil {
					// Session might be momentarily absent during overwrite.
					continue
				}
				// Each credential should be internally consistent: if
				// username is "writer-X-iter-Y", password should be
				// "pass-X-iter-Y". If they don't match, we got a partial
				// read mixing two different writes.
				//
				// However, since HandlePush replaces the entire struct
				// atomically under a write lock, this should never happen.
				// We also accept the initial seed values.
				if creds.Username == "initial-user" && creds.Password == "initial-pass" {
					continue
				}
				// Extract the suffix from username and password.
				uSuffix := creds.Username[len("writer-"):]
				pSuffix := creds.Password[len("pass-"):]
				if uSuffix != pSuffix {
					partialReads.Add(1)
				}
			}
		}()
	}

	wg.Wait()

	if partialReads.Load() > 0 {
		t.Errorf("detected %d partial/mixed reads -- credential overwrite is not atomic", partialReads.Load())
	}
}
