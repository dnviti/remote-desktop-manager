package main

import (
	"bytes"
	"context"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The dev stack ships prebuilt tunnel materials, so bootstrap copies that CA into the tenant record instead of rotating it.
func syncTenantTunnelCA(ctx context.Context, deps *apiDependencies, tenantID, certDir string) error {
	caCertPEM, err := os.ReadFile(filepath.Join(certDir, "ca.pem"))
	if err != nil {
		return fmt.Errorf("read tenant tunnel CA certificate: %w", err)
	}
	caKeyPEM, err := os.ReadFile(filepath.Join(certDir, "ca-key.pem"))
	if err != nil {
		return fmt.Errorf("read tenant tunnel CA key: %w", err)
	}

	encryptedKey, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, string(bytes.TrimSpace(caKeyPEM)))
	if err != nil {
		return fmt.Errorf("encrypt tenant tunnel CA key: %w", err)
	}
	fingerprint, err := certificateFingerprint(string(caCertPEM))
	if err != nil {
		return fmt.Errorf("fingerprint tenant tunnel CA certificate: %w", err)
	}

	if _, err := deps.db.Exec(ctx, `
UPDATE "Tenant"
SET "tunnelCaCert" = $2,
    "tunnelCaKey" = $3,
    "tunnelCaKeyIV" = $4,
    "tunnelCaKeyTag" = $5,
    "tunnelCaCertFingerprint" = $6
WHERE id = $1
`, tenantID, string(caCertPEM), encryptedKey.Ciphertext, encryptedKey.IV, encryptedKey.Tag, fingerprint); err != nil {
		return fmt.Errorf("store tenant tunnel CA: %w", err)
	}
	return nil
}

// upsertDevGateway keeps stable seeded gateway IDs across reruns while refreshing tunnel secrets and cert material.
func upsertDevGateway(ctx context.Context, deps *apiDependencies, tenantID, userID string, spec devGatewaySpec) error {
	var (
		encryptedTokenCipher any
		encryptedTokenIV     any
		encryptedTokenTag    any
		tunnelTokenHash      any
		tunnelClientCert     any
		tunnelClientCertExp  any
		tunnelClientKey      any
		tunnelClientKeyIV    any
		tunnelClientKeyTag   any
	)
	if spec.TunnelEnabled {
		certPEM, keyPEM, expiry, err := readClientCertBundle(spec.CertDir)
		if err != nil {
			return err
		}
		encryptedToken, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, spec.Token)
		if err != nil {
			return fmt.Errorf("encrypt tunnel token for %s: %w", spec.ID, err)
		}
		encryptedKey, err := encryptBootstrapValue(deps.gatewayService.ServerEncryptionKey, keyPEM)
		if err != nil {
			return fmt.Errorf("encrypt tunnel client key for %s: %w", spec.ID, err)
		}
		encryptedTokenCipher = encryptedToken.Ciphertext
		encryptedTokenIV = encryptedToken.IV
		encryptedTokenTag = encryptedToken.Tag
		tunnelTokenHash = hashToken(spec.Token)
		tunnelClientCert = certPEM
		tunnelClientCertExp = expiry
		tunnelClientKey = encryptedKey.Ciphertext
		tunnelClientKeyIV = encryptedKey.IV
		tunnelClientKeyTag = encryptedKey.Tag
	}

	if _, err := deps.db.Exec(ctx, `
UPDATE "Gateway"
SET "isDefault" = false
WHERE "tenantId" = $1
  AND type = $2::"GatewayType"
  AND id <> $3
  AND "isDefault" = true
`, tenantID, spec.Type, spec.ID); err != nil {
		return fmt.Errorf("clear existing default gateway for %s: %w", spec.Type, err)
	}

	if _, err := deps.db.Exec(ctx, `
INSERT INTO "Gateway" (
  id, name, type, host, port, "apiPort", description, "tenantId", "createdById",
  "isDefault", "deploymentMode", "isManaged", "publishPorts", "desiredReplicas", "lbStrategy",
  "tunnelEnabled", "encryptedTunnelToken", "tunnelTokenIV", "tunnelTokenTag", "tunnelTokenHash",
  "tunnelClientCert", "tunnelClientCertExp", "tunnelClientKey", "tunnelClientKeyIV", "tunnelClientKeyTag",
  "monitoringEnabled", "monitorIntervalMs", "inactivityTimeoutSeconds", "egressPolicy", "updatedAt"
) VALUES (
  $1, $2, $3::"GatewayType", $4, $5, $6, $7, $8, $9,
  true, $10::"GatewayDeploymentMode", $11, false, 1, 'ROUND_ROBIN'::"LoadBalancingStrategy",
  $12, $13, $14, $15, $16,
  $17, $18, $19, $20, $21,
  true, 5000, 3600, COALESCE(NULLIF($22, '')::jsonb, '{"rules":[]}'::jsonb), NOW()
)
ON CONFLICT (id) DO UPDATE
SET name = EXCLUDED.name,
    type = EXCLUDED.type,
    host = EXCLUDED.host,
    port = EXCLUDED.port,
    "apiPort" = EXCLUDED."apiPort",
    description = EXCLUDED.description,
    "tenantId" = EXCLUDED."tenantId",
    "createdById" = EXCLUDED."createdById",
    "isDefault" = true,
    "deploymentMode" = EXCLUDED."deploymentMode",
    "isManaged" = EXCLUDED."isManaged",
    "publishPorts" = false,
    "desiredReplicas" = 1,
    "lbStrategy" = 'ROUND_ROBIN'::"LoadBalancingStrategy",
    "tunnelEnabled" = EXCLUDED."tunnelEnabled",
    "encryptedTunnelToken" = EXCLUDED."encryptedTunnelToken",
    "tunnelTokenIV" = EXCLUDED."tunnelTokenIV",
    "tunnelTokenTag" = EXCLUDED."tunnelTokenTag",
    "tunnelTokenHash" = EXCLUDED."tunnelTokenHash",
    "tunnelClientCert" = EXCLUDED."tunnelClientCert",
    "tunnelClientCertExp" = EXCLUDED."tunnelClientCertExp",
    "tunnelClientKey" = EXCLUDED."tunnelClientKey",
    "tunnelClientKeyIV" = EXCLUDED."tunnelClientKeyIV",
    "tunnelClientKeyTag" = EXCLUDED."tunnelClientKeyTag",
    "monitoringEnabled" = true,
    "monitorIntervalMs" = 5000,
    "inactivityTimeoutSeconds" = 3600,
    "egressPolicy" = COALESCE(EXCLUDED."egressPolicy", '{"rules":[]}'::jsonb),
    "updatedAt" = NOW()
`, spec.ID, spec.Name, spec.Type, spec.Host, spec.Port, spec.APIPort, spec.Description, tenantID, userID,
		spec.DeploymentMode, spec.IsManaged, spec.TunnelEnabled,
		encryptedTokenCipher, encryptedTokenIV, encryptedTokenTag, tunnelTokenHash,
		tunnelClientCert, tunnelClientCertExp, tunnelClientKey, tunnelClientKeyIV, tunnelClientKeyTag, spec.EgressPolicy); err != nil {
		return fmt.Errorf("upsert gateway %s: %w", spec.ID, err)
	}
	return nil
}

func readClientCertBundle(certDir string) (string, string, time.Time, error) {
	certPEM, err := os.ReadFile(filepath.Join(certDir, "client-cert.pem"))
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("read tunnel client certificate from %s: %w", certDir, err)
	}
	keyPEM, err := os.ReadFile(filepath.Join(certDir, "client-key.pem"))
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("read tunnel client key from %s: %w", certDir, err)
	}
	block, _ := pem.Decode(certPEM)
	if block == nil {
		return "", "", time.Time{}, fmt.Errorf("decode tunnel client certificate from %s", certDir)
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return "", "", time.Time{}, fmt.Errorf("parse tunnel client certificate from %s: %w", certDir, err)
	}
	return strings.TrimSpace(string(certPEM)), strings.TrimSpace(string(keyPEM)), cert.NotAfter.UTC(), nil
}
