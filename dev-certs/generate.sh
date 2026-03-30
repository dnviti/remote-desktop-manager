#!/usr/bin/env bash
# Generates all development TLS certificates for Arsenale.
# Uses a SINGLE shared CA for all services — every cert is signed by dev-certs/ca.pem.
#
# Usage: ./dev-certs/generate.sh
#
# Structure:
#   dev-certs/
#     ca.pem / ca-key.pem         — shared CA (trusted by all services)
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
SPIFFE_TRUST_DOMAIN="${SPIFFE_TRUST_DOMAIN:-arsenale.local}"

echo "=== Generating shared CA ==="
openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/ca-key.pem" -out "$CERT_DIR/ca.pem" \
  -days "$DAYS" -subj "/CN=arsenale-dev-ca/O=Arsenale" \
  -addext "basicConstraints = critical, CA:TRUE" \
  -addext "keyUsage = critical, keyCertSign, cRLSign" \
  -batch 2>/dev/null
chmod 600 "$CERT_DIR/ca-key.pem"

service_spiffe_id() {
  local service_name="$1"
  printf 'spiffe://%s/service/%s' "$SPIFFE_TRUST_DOMAIN" "$service_name"
}

gateway_spiffe_id() {
  local gateway_id="$1"
  printf 'spiffe://%s/gateway/%s' "$SPIFFE_TRUST_DOMAIN" "$gateway_id"
}

generate_server_cert() {
  local dir="$1" cn="$2" sans="$3" spiffe_id="$4" extra_eku="${5:-}"
  mkdir -p "$dir"
  local eku="serverAuth"
  if [ -n "$extra_eku" ]; then
    eku="serverAuth, $extra_eku"
  fi
  openssl ecparam -genkey -name prime256v1 -out "$dir/server-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/server-key.pem" -out "$dir/server.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/server-ext.cnf" <<EOF
subjectAltName = $sans, URI:$spiffe_id
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
  local dir="$1" cn="$2" spiffe_id="$3" ca_cert="${4:-$CERT_DIR/ca.pem}" ca_key="${5:-$CERT_DIR/ca-key.pem}"
  openssl ecparam -genkey -name prime256v1 -out "$dir/client-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/client-key.pem" -out "$dir/client.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null
  cat > "$dir/client-ext.cnf" <<EOF
subjectAltName = URI:$spiffe_id
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF
  openssl x509 -req -sha256 -in "$dir/client.csr" \
    -CA "$ca_cert" -CAkey "$ca_key" \
    -CAcreateserial -out "$dir/client-cert.pem" -days "$DAYS" \
    -extfile "$dir/client-ext.cnf" 2>/dev/null
  rm -f "$dir"/*.csr "$dir"/*.cnf
}

# 1. tunnel (mTLS server)
echo "=== Tunnel mTLS ==="
generate_server_cert "$CERT_DIR/tunnel" "localhost" "DNS:localhost, IP:127.0.0.1, IP:::1" "$(service_spiffe_id tunnel)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/tunnel/server-key.pem"

# 2. PostgreSQL
echo "=== PostgreSQL SSL ==="
generate_server_cert "$CERT_DIR/postgres" "postgres" "DNS:postgres, DNS:localhost, IP:127.0.0.1" "$(service_spiffe_id postgres)"
chmod 600 "$CERT_DIR/postgres/server-key.pem"  # PostgreSQL requires strict perms

# 3. guacenc sidecar
echo "=== Guacenc HTTPS ==="
generate_server_cert "$CERT_DIR/guacenc" "guacenc" "DNS:guacenc, DNS:localhost, IP:127.0.0.1" "$(service_spiffe_id guacenc)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/guacenc/server-key.pem"

# 4. guacd (Guacamole Daemon — TLS listener)
echo "=== guacd TLS ==="
generate_server_cert "$CERT_DIR/guacd" "guacd" "DNS:guacd, DNS:localhost, IP:127.0.0.1" "$(service_spiffe_id guacd)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/guacd/server-key.pem"

# 5. SSH Gateway gRPC mTLS (server cert for the gateway + client cert for the Arsenale server)
echo "=== SSH Gateway gRPC mTLS ==="
generate_server_cert "$CERT_DIR/ssh-gateway" "ssh-gateway" "DNS:ssh-gateway, DNS:arsenale-ssh-gateway, DNS:dev-tunnel-ssh-gateway, DNS:localhost, IP:127.0.0.1" "$(service_spiffe_id ssh-gateway)" "clientAuth"
openssl ecparam -genkey -name prime256v1 -out "$CERT_DIR/ssh-gateway/client-ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$CERT_DIR/ssh-gateway/client-ca-key.pem" -out "$CERT_DIR/ssh-gateway/client-ca.pem" \
  -days "$DAYS" -subj "/CN=arsenale-ssh-gateway-client-ca/O=Arsenale" \
  -addext "basicConstraints = critical, CA:TRUE" \
  -addext "keyUsage = critical, keyCertSign, cRLSign" \
  -batch 2>/dev/null
generate_client_cert "$CERT_DIR/ssh-gateway" "arsenale-server" "$(service_spiffe_id server)" "$CERT_DIR/ssh-gateway/client-ca.pem" "$CERT_DIR/ssh-gateway/client-ca-key.pem"
chmod 600 "$CERT_DIR/ssh-gateway/client-ca-key.pem"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/ssh-gateway"/*-key.pem

# 6. RD Gateway (MS-TSGU proxy)
echo "=== RD Gateway HTTPS ==="
generate_server_cert "$CERT_DIR/rdgw" "rdgw" "DNS:rdgw, DNS:arsenale-rdgw, DNS:localhost, IP:127.0.0.1" "$(service_spiffe_id rdgw)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/rdgw/server-key.pem"

# 7. Development tunnel gateway client certificates
echo "=== Development tunnel gateway mTLS ==="
generate_client_cert "$CERT_DIR/tunnel-managed-ssh" "dev-tunnel-managed-ssh" "$(gateway_spiffe_id 11111111-1111-4111-8111-111111111111)"
generate_client_cert "$CERT_DIR/tunnel-guacd" "dev-tunnel-guacd" "$(gateway_spiffe_id 22222222-2222-4222-8222-222222222222)"
generate_client_cert "$CERT_DIR/tunnel-db-proxy" "dev-tunnel-db-proxy" "$(gateway_spiffe_id 33333333-3333-4333-8333-333333333333)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/tunnel-managed-ssh/client-key.pem" "$CERT_DIR/tunnel-guacd/client-key.pem" "$CERT_DIR/tunnel-db-proxy/client-key.pem"

# 8. Frontend HTTPS
echo "=== Frontend HTTPS ==="
generate_server_cert "$CERT_DIR/client" "localhost" "DNS:arsenale-client, DNS:localhost, IP:127.0.0.1, IP:::1" "$(service_spiffe_id client)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/client/server-key.pem"

# 9. Express + guacamole-lite
echo "=== Dev Server HTTPS ==="
generate_server_cert "$CERT_DIR/server" "arsenale-server" "DNS:arsenale-server, DNS:server, DNS:localhost, IP:127.0.0.1, IP:::1" "$(service_spiffe_id server)"
chmod "$RUNTIME_KEY_MODE" "$CERT_DIR/server/server-key.pem"

# Cleanup CA serial file
rm -f "$CERT_DIR"/*.srl

echo ""
echo "=== All certificates generated (shared CA: $CERT_DIR/ca.pem) ==="
echo "  tunnel:      $CERT_DIR/tunnel/"
echo "  PostgreSQL:  $CERT_DIR/postgres/"
echo "  guacenc:     $CERT_DIR/guacenc/"
echo "  guacd:       $CERT_DIR/guacd/"
echo "  ssh-gateway: $CERT_DIR/ssh-gateway/"
echo "  rdgw:        $CERT_DIR/rdgw/"
echo "  tunnel-managed-ssh: $CERT_DIR/tunnel-managed-ssh/"
echo "  tunnel-guacd:       $CERT_DIR/tunnel-guacd/"
echo "  tunnel-db-proxy:    $CERT_DIR/tunnel-db-proxy/"
echo "  client:      $CERT_DIR/client/"
echo "  server:      $CERT_DIR/server/"
