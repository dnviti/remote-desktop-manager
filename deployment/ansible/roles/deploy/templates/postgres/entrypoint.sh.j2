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

if [ -n "${POSTGRES_PASSWORD_FILE:-}" ] && [ -f "${POSTGRES_PASSWORD_FILE}" ] && [ -z "${POSTGRES_PASSWORD:-}" ]; then
  POSTGRES_PASSWORD="$(tr -d '\r\n' < "${POSTGRES_PASSWORD_FILE}")"
  export POSTGRES_PASSWORD
fi

if [ -n "${POSTGRESQL_PASSWORD_FILE:-}" ] && [ -f "${POSTGRESQL_PASSWORD_FILE}" ] && [ -z "${POSTGRESQL_PASSWORD:-}" ]; then
  POSTGRESQL_PASSWORD="$(tr -d '\r\n' < "${POSTGRESQL_PASSWORD_FILE}")"
  export POSTGRESQL_PASSWORD
fi

if command -v run-postgresql >/dev/null 2>&1; then
  : "${POSTGRES_USER:=postgres}"
  : "${POSTGRES_DB:=${POSTGRES_USER}}"
  : "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD or POSTGRES_PASSWORD_FILE must be set}"

  export POSTGRESQL_USER="${POSTGRESQL_USER:-${POSTGRES_USER}}"
  export POSTGRESQL_DATABASE="${POSTGRESQL_DATABASE:-${POSTGRES_DB}}"
  export POSTGRESQL_PASSWORD="${POSTGRESQL_PASSWORD:-${POSTGRES_PASSWORD}}"

  if [ "$(id -u)" = "0" ] && command -v setpriv >/dev/null 2>&1; then
    POSTGRES_UID="$(id -u postgres)"
    POSTGRES_GID="$(id -g postgres)"
    exec setpriv --reuid="${POSTGRES_UID}" --regid="${POSTGRES_GID}" --init-groups \
      run-postgresql \
      -c listen_addresses='*' \
      -c hba_file=/etc/postgresql/pg_hba.conf \
      -c ssl=on \
      -c ssl_cert_file="${CERT_DST}" \
      -c ssl_key_file="${KEY_DST}"
  fi

  exec run-postgresql \
    -c listen_addresses='*' \
    -c hba_file=/etc/postgresql/pg_hba.conf \
    -c ssl=on \
    -c ssl_cert_file="${CERT_DST}" \
    -c ssl_key_file="${KEY_DST}"
fi

if command -v docker-entrypoint.sh >/dev/null 2>&1; then
  exec docker-entrypoint.sh postgres \
    -c listen_addresses='*' \
    -c hba_file=/etc/postgresql/pg_hba.conf \
    -c ssl=on \
    -c ssl_cert_file="${CERT_DST}" \
    -c ssl_key_file="${KEY_DST}"
fi

echo "Unsupported PostgreSQL image: neither run-postgresql nor docker-entrypoint.sh was found" >&2
exit 1
