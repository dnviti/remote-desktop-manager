package mfaapi

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"io"
	"net/url"
	"strings"
	"time"
)

const totpAppName = "Arsenale"

func generateTOTPSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := io.ReadFull(rand.Reader, buf); err != nil {
		return "", fmt.Errorf("generate totp secret: %w", err)
	}
	return base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(buf), nil
}

func buildOTPAuthURI(email, secret string) string {
	label := url.PathEscape(totpAppName + ":" + email)
	return fmt.Sprintf(
		"otpauth://totp/%s?secret=%s&issuer=%s&algorithm=SHA1&digits=6&period=30",
		label,
		url.QueryEscape(secret),
		url.QueryEscape(totpAppName),
	)
}

func verifyTOTP(secret, code string, now time.Time) bool {
	key, err := decodeTOTPSecret(secret)
	if err != nil {
		return false
	}
	counter := now.UTC().Unix() / 30
	for _, offset := range []int64{-1, 0, 1} {
		if generateTOTPCode(key, counter+offset) == code {
			return true
		}
	}
	return false
}

func decodeTOTPSecret(secret string) ([]byte, error) {
	cleaned := strings.ToUpper(strings.TrimSpace(secret))
	cleaned = strings.ReplaceAll(cleaned, " ", "")
	cleaned = strings.ReplaceAll(cleaned, "-", "")
	return base32.StdEncoding.WithPadding(base32.NoPadding).DecodeString(cleaned)
}

func generateTOTPCode(key []byte, counter int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(counter))
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	value := int(binary.BigEndian.Uint32(sum[offset:offset+4]) & 0x7fffffff)
	return fmt.Sprintf("%06d", value%1_000_000)
}
