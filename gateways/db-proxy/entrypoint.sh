#!/bin/sh
set -e

export PORT="${DB_LISTEN_PORT:-5432}"

db_proxy_pid=""
tunnel_pid=""

shutdown() {
  if [ -n "$tunnel_pid" ] && kill -0 "$tunnel_pid" 2>/dev/null; then
    kill "$tunnel_pid" 2>/dev/null || true
  fi
  if [ -n "$db_proxy_pid" ] && kill -0 "$db_proxy_pid" 2>/dev/null; then
    kill "$db_proxy_pid" 2>/dev/null || true
  fi
  wait "$tunnel_pid" 2>/dev/null || true
  wait "$db_proxy_pid" 2>/dev/null || true
  exit 0
}

trap shutdown INT TERM

echo "[db-proxy] Starting middleware service on port ${PORT}..."
/usr/local/bin/db-proxy &
db_proxy_pid=$!

if [ -n "$TUNNEL_SERVER_URL" ] && [ -n "$TUNNEL_TOKEN" ]; then
  echo "[db-proxy] Starting tunnel agent..."
  arsenale-tunnel-agent &
  tunnel_pid=$!
fi

echo "[db-proxy] Database proxy gateway ready on port ${PORT}"

while :; do
  if ! kill -0 "$db_proxy_pid" 2>/dev/null; then
    wait "$db_proxy_pid" || true
    exit 1
  fi

  if [ -n "$tunnel_pid" ] && ! kill -0 "$tunnel_pid" 2>/dev/null; then
    wait "$tunnel_pid" || true
    exit 1
  fi

  sleep 1
done
