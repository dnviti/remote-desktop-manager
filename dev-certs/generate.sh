#!/usr/bin/env bash
# Generates all development TLS certificates for Arsenale.
# Uses a SINGLE shared CA for all services — every cert is signed by dev-certs/ca.pem.
#
# Usage: ./dev-certs/generate.sh
#
# Structure:
#   dev-certs/
#     ca.pem / ca-key.pem         — shared CA (trusted by all services)
#     gocache/                    — gocache gRPC mTLS (server + client)
#     tunnel/                     — tunnel mTLS server
#     postgres/                   — PostgreSQL SSL
#     guacenc/                    — guacenc sidecar HTTPS
#     server/                     — Express + guacamole-lite HTTPS

set -euo pipefail
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAYS=3650

echo "=== Generating shared CA ==="
openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/ca-key.pem" -out "$CERT_DIR/ca.pem" \
  -days "$DAYS" -subj "/CN=arsenale-dev-ca/O=Arsenale" -batch 2>/dev/null

generate_server_cert() {
  local dir="$1" cn="$2" sans="$3"
  mkdir -p "$dir"
  openssl ecparam -genkey -name prime256v1 -out "$dir/server-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/server-key.pem" -out "$dir/server.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/server-ext.cnf" <<EOF
subjectAltName = $sans
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
EOF
  openssl x509 -req -sha256 -in "$dir/server.csr" \
    -CA "$CERT_DIR/ca.pem" -CAkey "$CERT_DIR/ca-key.pem" \
    -CAcreateserial -out "$dir/server-cert.pem" -days "$DAYS" \
    -extfile "$dir/server-ext.cnf" 2>/dev/null
  rm -f "$dir"/*.csr "$dir"/*.cnf
}

generate_client_cert() {
  local dir="$1" cn="$2"
  openssl ecparam -genkey -name prime256v1 -out "$dir/client-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/client-key.pem" -out "$dir/client.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/client-ext.cnf" <<EOF
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -sha256 -in "$dir/client.csr" \
    -CA "$CERT_DIR/ca.pem" -CAkey "$CERT_DIR/ca-key.pem" \
    -CAcreateserial -out "$dir/client-cert.pem" -days "$DAYS" \
    -extfile "$dir/client-ext.cnf" 2>/dev/null
  rm -f "$dir"/*.csr "$dir"/*.cnf
}

# 1. gocache (gRPC mTLS — server + client)
echo "=== gocache mTLS ==="
generate_server_cert "$CERT_DIR/gocache" "gocache" "DNS:gocache, DNS:localhost, IP:127.0.0.1, IP:::1"
generate_client_cert "$CERT_DIR/gocache" "arsenale-server"
chmod 644 "$CERT_DIR/gocache"/*-key.pem  # Rootless container UID 10001

# 2. tunnel (mTLS server)
echo "=== Tunnel mTLS ==="
generate_server_cert "$CERT_DIR/tunnel" "localhost" "DNS:localhost, IP:127.0.0.1, IP:::1"

# 3. PostgreSQL
echo "=== PostgreSQL SSL ==="
generate_server_cert "$CERT_DIR/postgres" "postgres" "DNS:postgres, DNS:localhost, IP:127.0.0.1"
chmod 600 "$CERT_DIR/postgres/server-key.pem"  # PostgreSQL requires strict perms

# 4. guacenc sidecar
echo "=== Guacenc HTTPS ==="
generate_server_cert "$CERT_DIR/guacenc" "guacenc" "DNS:guacenc, DNS:localhost, IP:127.0.0.1"

# 5. Express + guacamole-lite
echo "=== Dev Server HTTPS ==="
generate_server_cert "$CERT_DIR/server" "localhost" "DNS:localhost, IP:127.0.0.1, IP:::1"

# Cleanup CA serial file
rm -f "$CERT_DIR"/*.srl

echo ""
echo "=== All certificates generated (shared CA: $CERT_DIR/ca.pem) ==="
echo "  gocache:    $CERT_DIR/gocache/"
echo "  tunnel:     $CERT_DIR/tunnel/"
echo "  PostgreSQL: $CERT_DIR/postgres/"
echo "  guacenc:    $CERT_DIR/guacenc/"
echo "  server:     $CERT_DIR/server/"
