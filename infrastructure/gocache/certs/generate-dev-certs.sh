#!/usr/bin/env bash
# Generate self-signed CA + server/client certificates for the split gocache
# cache and pubsub backends (development only).
# Usage: ./generate-dev-certs.sh [output-dir]
#
# Produces:
#   ca.pem / ca-key.pem                — Certificate Authority
#   gocache-cache/{server,client}-*    — Cache backend mTLS material
#   gocache-pubsub/{server,client}-*   — Pubsub backend mTLS material

set -euo pipefail

OUT="${1:-.}"
mkdir -p "$OUT"
DAYS=3650  # 10 years for dev certs
RUNTIME_KEY_MODE=0644
SPIFFE_TRUST_DOMAIN="${SPIFFE_TRUST_DOMAIN:-arsenale.local}"

service_spiffe_id() {
  local service_name="$1"
  printf 'spiffe://%s/service/%s' "$SPIFFE_TRUST_DOMAIN" "$service_name"
}

echo "==> Generating CA..."
openssl ecparam -genkey -name prime256v1 -out "$OUT/ca-key.pem" 2>/dev/null
openssl req -new -x509 -sha256 -key "$OUT/ca-key.pem" -out "$OUT/ca.pem" \
  -days "$DAYS" -subj "/CN=gocache-dev-ca/O=Arsenale" -batch 2>/dev/null
chmod 600 "$OUT/ca-key.pem"

generate_backend() {
	local dir="$1"
	local cn="$2"
	local client_cn="$3"
	local server_spiffe_id="$4"
	local client_spiffe_id="$5"
	mkdir -p "$dir"

  echo "==> Generating server certificate ($cn)..."
  openssl ecparam -genkey -name prime256v1 -out "$dir/server-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/server-key.pem" -out "$dir/server.csr" \
    -subj "/CN=$cn/O=Arsenale" -batch 2>/dev/null

	cat > "$dir/server-ext.cnf" <<EOF
subjectAltName = DNS:$cn, DNS:localhost, IP:127.0.0.1, IP:::1, URI:$server_spiffe_id
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth, clientAuth
EOF

  openssl x509 -req -sha256 -in "$dir/server.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca-key.pem" \
    -CAcreateserial -out "$dir/server-cert.pem" -days "$DAYS" \
    -extfile "$dir/server-ext.cnf" 2>/dev/null

  echo "==> Generating client certificate ($client_cn)..."
  openssl ecparam -genkey -name prime256v1 -out "$dir/client-key.pem" 2>/dev/null
  openssl req -new -sha256 -key "$dir/client-key.pem" -out "$dir/client.csr" \
    -subj "/CN=$client_cn/O=Arsenale" -batch 2>/dev/null

	cat > "$dir/client-ext.cnf" <<EOF
subjectAltName = URI:$client_spiffe_id
keyUsage = digitalSignature, keyEncipherment
extendedKeyUsage = clientAuth
EOF

  openssl x509 -req -sha256 -in "$dir/client.csr" -CA "$OUT/ca.pem" -CAkey "$OUT/ca-key.pem" \
    -CAcreateserial -out "$dir/client-cert.pem" -days "$DAYS" \
    -extfile "$dir/client-ext.cnf" 2>/dev/null
}

generate_backend "$OUT/gocache-cache" "gocache-cache" "arsenale-server-cache" "$(service_spiffe_id gocache-cache)" "$(service_spiffe_id server)"
generate_backend "$OUT/gocache-pubsub" "gocache-pubsub" "arsenale-server-pubsub" "$(service_spiffe_id gocache-pubsub)" "$(service_spiffe_id server)"

# Clean up CSRs and temporary files
find "$OUT" -type f \( -name '*.csr' -o -name '*.cnf' -o -name '*.srl' \) -delete

# Runtime keys must be container-readable when bind-mounted into rootless dev containers.
find "$OUT" -mindepth 2 -type f -name '*-key.pem' -exec chmod "$RUNTIME_KEY_MODE" {} +

echo "==> Done. Certificates generated in: $OUT"
echo "    CA:     ca.pem / ca-key.pem"
echo "    Cache:  gocache-cache/{server,client}-*.pem"
echo "    PubSub: gocache-pubsub/{server,client}-*.pem"
