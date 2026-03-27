#!/usr/bin/env sh
set -eu

TLS_DIR="/tmp/postgres-tls"
CERT_SRC="/certs/server-cert.pem"
KEY_SRC="/certs/server-key.pem"
CERT_DST="${TLS_DIR}/server-cert.pem"
KEY_DST="${TLS_DIR}/server-key.pem"

mkdir -p "${TLS_DIR}"

cp "${CERT_SRC}" "${CERT_DST}"
cp "${KEY_SRC}" "${KEY_DST}"
chmod 600 "${KEY_DST}"

if command -v chown >/dev/null 2>&1; then
  chown postgres:postgres "${CERT_DST}" "${KEY_DST}" 2>/dev/null || true
fi

exec docker-entrypoint.sh postgres \
  -c hba_file=/etc/postgresql/pg_hba.conf \
  -c ssl=on \
  -c ssl_cert_file="${CERT_DST}" \
  -c ssl_key_file="${KEY_DST}"
