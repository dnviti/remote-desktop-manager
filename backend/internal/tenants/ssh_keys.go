package tenants

import (
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/x509"
	"encoding/hex"
	"encoding/pem"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/ssh"
)

type encryptedField struct {
	Ciphertext string
	IV         string
	Tag        string
}

func (s Service) ensureTenantSSHKeyPair(ctx context.Context, tenantID string) error {
	if s.DB == nil || len(s.ServerEncryptionKey) != 32 {
		return nil
	}

	_, privateKey, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("generate ed25519 key pair: %w", err)
	}

	pkcs8, err := x509.MarshalPKCS8PrivateKey(privateKey)
	if err != nil {
		return fmt.Errorf("marshal private key: %w", err)
	}
	privatePEM := pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: pkcs8})

	publicKey, err := ssh.NewPublicKey(privateKey.Public())
	if err != nil {
		return fmt.Errorf("marshal public key: %w", err)
	}

	encrypted, err := encryptTenantValue(s.ServerEncryptionKey, string(privatePEM))
	if err != nil {
		return fmt.Errorf("encrypt private key: %w", err)
	}

	_, err = s.DB.Exec(ctx, `
INSERT INTO "SshKeyPair" ("tenantId", "encryptedPrivateKey", "privateKeyIV", "privateKeyTag", "publicKey", fingerprint, algorithm)
VALUES ($1, $2, $3, $4, $5, $6, 'ed25519')
ON CONFLICT ("tenantId") DO NOTHING
`,
		tenantID,
		encrypted.Ciphertext,
		encrypted.IV,
		encrypted.Tag,
		strings.TrimSpace(string(ssh.MarshalAuthorizedKey(publicKey))),
		ssh.FingerprintSHA256(publicKey),
	)
	if err != nil {
		return fmt.Errorf("insert ssh key pair: %w", err)
	}

	return nil
}

func encryptTenantValue(key []byte, plaintext string) (encryptedField, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create cipher: %w", err)
	}
	gcm, err := cipher.NewGCMWithNonceSize(block, 16)
	if err != nil {
		return encryptedField{}, fmt.Errorf("create gcm: %w", err)
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return encryptedField{}, fmt.Errorf("generate nonce: %w", err)
	}
	sealed := gcm.Seal(nil, nonce, []byte(plaintext), nil)
	tagSize := gcm.Overhead()
	return encryptedField{
		Ciphertext: hex.EncodeToString(sealed[:len(sealed)-tagSize]),
		IV:         hex.EncodeToString(nonce),
		Tag:        hex.EncodeToString(sealed[len(sealed)-tagSize:]),
	}, nil
}
