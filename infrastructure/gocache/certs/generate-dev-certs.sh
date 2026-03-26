#!/usr/bin/env bash
# Generate self-signed CA + server/client certificates for gocache mTLS (development only).
# Usage: ./generate-dev-certs.sh [output-dir]
#
# Produces:
#   ca.pem / ca-key.pem          — Certificate Authority
#   server-cert.pem / server-key.pem  — gocache sidecar (server)
#   client-cert.pem / client-key.pem  — Arsenale server (client)

set -euo pipefail

OUT="${1:-.}"
mkdir -p "$OUT"
DAYS=3650  # 10 years for dev certs

echo "==> Generating CA..."
openssl ecparam -genkey -name prime256v1 -out "$OUT/ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$OUT/ca-key.pem" -out "$OUT/ca.pem" \
  -days "$DAYS" -subj "/CN=gocache-dev-ca/O=Arsenale" -batch 2>/dev/null

echo "==> Generating server certificate (gocache)..."
openssl ecparam -genkey -name prime256v1 -out "$OUT/server-key.pem" 2>/dev/null
openssl req -new -sha256 -key "$OUT/server-key.pem" -out "$OUT/server.csr" \
  -subj "/CN=gocache/O=Arsenale" -batch 2>/dev/null

cat > "$OUT/server-ext.cnf" <<EOF
subjectAltName = DNS:gocache, DNS:localhost, IP:127.0.0.1, IP:::1
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF

openssl x509 -req -sha256 -in "$OUT/server.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca-key.pem" \
  -CAcreateserial -out "$OUT/server-cert.pem" -days "$DAYS" \
  -extfile "$OUT/server-ext.cnf" 2>/dev/null

echo "==> Generating client certificate (arsenale-server)..."
openssl ecparam -genkey -name prime256v1 -out "$OUT/client-key.pem" 2>/dev/null
openssl req -new -sha256 -key "$OUT/client-key.pem" -out "$OUT/client.csr" \
  -subj "/CN=arsenale-server/O=Arsenale" -batch 2>/dev/null

cat > "$OUT/client-ext.cnf" <<EOF
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

openssl x509 -req -sha256 -in "$OUT/client.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca-key.pem" \
  -CAcreateserial -out "$OUT/client-cert.pem" -days "$DAYS" \
  -extfile "$OUT/client-ext.cnf" 2>/dev/null

# Clean up CSRs and temporary files
rm -f "$OUT"/*.csr "$OUT"/*.cnf "$OUT"/*.srl

# Make key files readable by rootless container users (UID 10001)
chmod 644 "$OUT"/*-key.pem

echo "==> Done. Certificates generated in: $OUT"
echo "    CA:     ca.pem / ca-key.pem"
echo "    Server: server-cert.pem / server-key.pem"
echo "    Client: client-cert.pem / client-key.pem"
