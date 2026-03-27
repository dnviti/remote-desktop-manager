#!/usr/bin/env bash
# Generates all development TLS certificates for Arsenale.
# Uses a SINGLE shared CA for all services — every cert is signed by dev-certs/ca.pem.
#
# Usage: ./dev-certs/generate.sh
#
# Structure:
#   dev-certs/
#     ca.pem / ca-key.pem         — shared CA (trusted by all services)
#     gocache-cache/              — cache service gRPC mTLS (server + client)
#     gocache-pubsub/             — pubsub service gRPC mTLS (server + client)
#     tunnel/                     — tunnel mTLS server
#     postgres/                   — PostgreSQL SSL
#     guacenc/                    — guacenc sidecar HTTPS
#     guacd/                      — guacd TLS listener
#     ssh-gateway/                — SSH Gateway API HTTPS
#     rdgw/                       — RD Gateway HTTPS
#     server/                     — Express + guacamole-lite HTTPS

set -euo pipefail
CERT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAYS=3650
RUNTIME_KEY_MODE=0644

echo "=== Generating shared CA ==="
openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/ca-key.pem" -out "$CERT_DIR/ca.pem" \
  -days "$DAYS" -subj "/CN=arsenale-dev-ca/O=Arsenale" \
  -addext "basicConstraints = critical, CA:TRUE" \
  -addext "keyUsage = critical, keyCertSign, cRLSign" \
  -batch 2>/dev/null
chmod 600 "$CERT_DIR/ca-key.pem"

generate_server_cert() {
  local dir="$1" cn="$2" sans="$3" extra_eku="${4:-}"
  mkdir -p "$dir"
  local eku="serverAuth"
  if [ -n "$extra_eku" ]; then
    eku="serverAuth, $extra_eku"
  fi
  openssl ecparam -genkey -name prime256v1 -out "$dir/server-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/server-key.pem" -out "$dir/server.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/server-ext.cnf" <<EOF
subjectAltName = $sans
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = $eku
EOF
  openssl x509 -req -sha256 -in "$dir/server.csr" \
    -CA "$CERT_DIR/ca.pem" -CAkey "$CERT_DIR/ca-key.pem" \
    -CAcreateserial -out "$dir/server-cert.pem" -days "$DAYS" \
    -extfile "$dir/server-ext.cnf" 2>/dev/null
  rm -f "$dir"/*.csr "$dir"/*.cnf
}

generate_client_cert() {
  local dir="$1" cn="$2" ca_cert="${3:-$CERT_DIR/ca.pem}" ca_key="${4:-$CERT_DIR/ca-key.pem}"
  openssl ecparam -genkey -name prime256v1 -out "$dir/client-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/client-key.pem" -out "$dir/client.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/client-ext.cnf" <<EOF
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -sha256 -in "$dir/client.csr" \
    -CA "$ca_cert" -CAkey "$ca_key" \
    -CAcreateserial -out "$dir/client-cert.pem" -days "$DAYS" \
    -extfile "$dir/client-ext.cnf" 2>/dev/null
  rm -f "$dir"/*.csr "$dir"/*.cnf
}

# 1. gocache-cache (gRPC mTLS — server + client)
echo "=== gocache-cache mTLS ==="
generate_server_cert "$CERT_DIR/gocache-cache" "gocache-cache" "DNS:gocache-cache, DNS:localhost, IP:127.0.0.1, IP:::1" "clientAuth"
generate_client_cert "$CERT_DIR/gocache-cache" "arsenale-server-cache"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/gocache-cache"/*-key.pem

# 2. gocache-pubsub (gRPC mTLS — server + client)
echo "=== gocache-pubsub mTLS ==="
generate_server_cert "$CERT_DIR/gocache-pubsub" "gocache-pubsub" "DNS:gocache-pubsub, DNS:localhost, IP:127.0.0.1, IP:::1" "clientAuth"
generate_client_cert "$CERT_DIR/gocache-pubsub" "arsenale-server-pubsub"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/gocache-pubsub"/*-key.pem

# 3. tunnel (mTLS server)
echo "=== Tunnel mTLS ==="
generate_server_cert "$CERT_DIR/tunnel" "localhost" "DNS:localhost, IP:127.0.0.1, IP:::1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/tunnel/server-key.pem"

# 4. PostgreSQL
echo "=== PostgreSQL SSL ==="
generate_server_cert "$CERT_DIR/postgres" "postgres" "DNS:postgres, DNS:localhost, IP:127.0.0.1"
chmod 600 "$CERT_DIR/postgres/server-key.pem"  # PostgreSQL requires strict perms

# 5. guacenc sidecar
echo "=== Guacenc HTTPS ==="
generate_server_cert "$CERT_DIR/guacenc" "guacenc" "DNS:guacenc, DNS:localhost, IP:127.0.0.1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/guacenc/server-key.pem"

# 6. guacd (Guacamole Daemon — TLS listener)
echo "=== guacd TLS ==="
generate_server_cert "$CERT_DIR/guacd" "guacd" "DNS:guacd, DNS:localhost, IP:127.0.0.1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/guacd/server-key.pem"

# 7. SSH Gateway gRPC mTLS (server cert for the gateway + client cert for the Arsenale server)
echo "=== SSH Gateway gRPC mTLS ==="
generate_server_cert "$CERT_DIR/ssh-gateway" "ssh-gateway" "DNS:ssh-gateway, DNS:arsenale-ssh-gateway, DNS:localhost, IP:127.0.0.1" "clientAuth"
openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/ssh-gateway/client-ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/ssh-gateway/client-ca-key.pem" -out "$CERT_DIR/ssh-gateway/client-ca.pem" \
  -days "$DAYS" -subj "/CN=arsenale-ssh-gateway-client-ca/O=Arsenale" \
  -addext "basicConstraints = critical, CA:TRUE" \
  -addext "keyUsage = critical, keyCertSign, cRLSign" \
  -batch 2>/dev/null
generate_client_cert "$CERT_DIR/ssh-gateway" "arsenale-server" "$CERT_DIR/ssh-gateway/client-ca.pem" "$CERT_DIR/ssh-gateway/client-ca-key.pem"
chmod 600 "$CERT_DIR/ssh-gateway/client-ca-key.pem"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/ssh-gateway"/*-key.pem

# 8. RD Gateway (MS-TSGU proxy)
echo "=== RD Gateway HTTPS ==="
generate_server_cert "$CERT_DIR/rdgw" "rdgw" "DNS:rdgw, DNS:arsenale-rdgw, DNS:localhost, IP:127.0.0.1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/rdgw/server-key.pem"

# 9. Frontend HTTPS
echo "=== Frontend HTTPS ==="
generate_server_cert "$CERT_DIR/client" "localhost" "DNS:arsenale-client, DNS:localhost, IP:127.0.0.1, IP:::1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/client/server-key.pem"

# 10. Express + guacamole-lite
echo "=== Dev Server HTTPS ==="
generate_server_cert "$CERT_DIR/server" "arsenale-server" "DNS:arsenale-server, DNS:server, DNS:localhost, IP:127.0.0.1, IP:::1"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/server/server-key.pem"

# Cleanup CA serial file
rm -f "$CERT_DIR"/*.srl

echo ""
echo "=== All certificates generated (shared CA: $CERT_DIR/ca.pem) ==="
echo "  gocache-cache:   $CERT_DIR/gocache-cache/"
echo "  gocache-pubsub: $CERT_DIR/gocache-pubsub/"
echo "  tunnel:      $CERT_DIR/tunnel/"
echo "  PostgreSQL:  $CERT_DIR/postgres/"
echo "  guacenc:     $CERT_DIR/guacenc/"
echo "  guacd:       $CERT_DIR/guacd/"
echo "  ssh-gateway: $CERT_DIR/ssh-gateway/"
echo "  rdgw:        $CERT_DIR/rdgw/"
echo "  client:      $CERT_DIR/client/"
echo "  server:      $CERT_DIR/server/"
