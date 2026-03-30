package authservice

import (
	"context"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const hibpAPIURL = "https://api.pwnedpasswords.com/range/"
const hibpUserAgent = "Arsenale-PasswordCheck"
const hibpTimeout = 5 * time.Second

func generateSalt() string {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate salt: %w", err))
	}
	return hex.EncodeToString(buf)
}

func generateMasterKey() []byte {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		panic(fmt.Errorf("generate master key: %w", err))
	}
	return buf
}

func generateRecoveryKey() (string, error) {
	buf := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}

func encryptMasterKey(masterKey, derivedKey []byte) (encryptedField, error) {
	if len(derivedKey) != 32 {
		return encryptedField{}, fmt.Errorf("derived key must be 32 bytes")
	}
	return encryptValue(derivedKey, hex.EncodeToString(masterKey))
}

func assertPasswordNotBreached(ctx context.Context, password string) error {
	sum := sha1.Sum([]byte(password))
	sha1Hex := strings.ToUpper(hex.EncodeToString(sum[:]))
	prefix := sha1Hex[:5]
	suffix := sha1Hex[5:]

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, hibpAPIURL+prefix, nil)
	if err != nil {
		return fmt.Errorf("prepare hibp request: %w", err)
	}
	req.Header.Set("User-Agent", hibpUserAgent)

	client := &http.Client{Timeout: hibpTimeout}
	resp, err := client.Do(req)
	if err != nil {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		if os.Getenv("HIBP_FAIL_OPEN") == "true" {
			return nil
		}
		return &requestError{status: http.StatusServiceUnavailable, message: "Password strength could not be verified. Please try again later."}
	}
	for _, line := range strings.Split(string(body), "\r\n") {
		hashSuffix, _, found := strings.Cut(line, ":")
		if found && hashSuffix == suffix {
			return &requestError{status: http.StatusBadRequest, message: "This password has appeared in a known data breach. Please choose a different password."}
		}
	}
	return nil
}
